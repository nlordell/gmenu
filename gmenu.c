// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Nicholas Rodrigues Lordello

#include <getopt.h>
#include <gio/gio.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define BUS_NAME "org.gnome.Shell.Extensions.GMenu"
#define OBJECT_PATH "/org/gnome/Shell/Extensions/GMenu"
#define INTERFACE_NAME "org.gnome.Shell.Extensions.GMenu"

#define MAX_KEYBINDINGS 16

typedef struct {
  int code;
  const char *binding;
} Keybinding;

typedef struct {
  GMainLoop *loop;
  GDBusConnection *bus;
  int exit_code;
} State;

static void on_item_selected(GDBusConnection *connection,
                             const gchar *sender_name, const gchar *object_path,
                             const gchar *interface_name,
                             const gchar *signal_name, GVariant *parameters,
                             gpointer user_data) {
  (void)connection;
  (void)sender_name;
  (void)object_path;
  (void)interface_name;
  (void)signal_name;

  State *state = user_data;
  gint32 code;
  const gchar *item;
  g_variant_get(parameters, "(i&s)", &code, &item);
  puts(item);

  state->exit_code = code == 0 ? EXIT_SUCCESS : 9 + code;
  g_main_loop_quit(state->loop);
}

static void on_cancelled(GDBusConnection *connection, const gchar *sender_name,
                         const gchar *object_path, const gchar *interface_name,
                         const gchar *signal_name, GVariant *parameters,
                         gpointer user_data) {
  (void)connection;
  (void)sender_name;
  (void)object_path;
  (void)interface_name;
  (void)signal_name;
  (void)parameters;

  State *state = user_data;
  state->exit_code = EXIT_FAILURE;
  g_main_loop_quit(state->loop);
}

static void on_error(GDBusConnection *connection, const gchar *sender_name,
                     const gchar *object_path, const gchar *interface_name,
                     const gchar *signal_name, GVariant *parameters,
                     gpointer user_data) {
  (void)connection;
  (void)sender_name;
  (void)object_path;
  (void)interface_name;
  (void)signal_name;

  State *state = user_data;
  const gchar *message;
  g_variant_get(parameters, "(&s)", &message);
  g_printerr("%s\n", message);

  state->exit_code = EXIT_FAILURE;
  g_main_loop_quit(state->loop);
}

static gboolean on_stdin_ready(GIOChannel *channel, GIOCondition cond,
                               gpointer user_data) {
  (void)cond;
  State *state = user_data;

  gchar *line = NULL;
  gsize len = 0;
  GError *error = NULL;
  GIOStatus status = g_io_channel_read_line(channel, &line, &len, NULL, &error);

  switch (status) {
  case G_IO_STATUS_NORMAL:
    while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r')) {
      line[--len] = '\0';
    }
    g_dbus_connection_call(state->bus, BUS_NAME, OBJECT_PATH, INTERFACE_NAME,
                           "ListItem", g_variant_new("(s)", line), NULL,
                           G_DBUS_CALL_FLAGS_NONE, -1, NULL, NULL, NULL);
    g_free(line);
    return G_SOURCE_CONTINUE;
  case G_IO_STATUS_AGAIN:
    g_free(line);
    return G_SOURCE_CONTINUE;
  case G_IO_STATUS_EOF:
  case G_IO_STATUS_ERROR:
  default:
    if (error) {
      g_error_free(error);
    }
    g_free(line);
    return G_SOURCE_REMOVE;
  }
}

static gboolean parse_keybinding(char *arg, Keybinding *out) {
  char *colon = strchr(arg, ':');
  if (!colon || colon == arg || colon[1] == '\0') {
    return FALSE;
  }
  *colon = '\0';
  char *end;
  long code = strtol(arg, &end, 10);
  if (*end != '\0' || code < 1 || code > 19) {
    return FALSE;
  }
  out->code = (int)code;
  out->binding = colon + 1;
  return TRUE;
}

static void usage(FILE *out, const char *prog) {
  fprintf(out,
          "usage: %s [options]\n"
          "options:\n"
          "  -p, --prompt PROMPT  set the menu prompt\n"
          "      --no-custom      disallow values not in the list\n"
          "      --kb CODE:KEY    bind a custom keyboard shortcut\n"
          "  -h, --help           show this help message\n",
          prog);
}

int main(int argc, char **argv) {
  const char *prompt = ">";
  gboolean allow_custom = TRUE;
  Keybinding keybindings[MAX_KEYBINDINGS];
  size_t n_keybindings = 0;

  static const struct option long_opts[] = {
      {"prompt", required_argument, NULL, 'p'},
      {"no-custom", no_argument, NULL, 'n'},
      {"kb", required_argument, NULL, 'k'},
      {"help", no_argument, NULL, 'h'},
      {0},
  };

  int opt;
  while ((opt = getopt_long(argc, argv, "p:h", long_opts, NULL)) != -1) {
    switch (opt) {
    case 'p':
      prompt = optarg;
      break;
    case 'n':
      allow_custom = FALSE;
      break;
    case 'k':
      if (n_keybindings >= MAX_KEYBINDINGS) {
        fprintf(stderr, "too many keybindings (max %d)\n", MAX_KEYBINDINGS);
        return EXIT_FAILURE;
      }
      if (!parse_keybinding(optarg, &keybindings[n_keybindings])) {
        fprintf(stderr, "invalid --kb argument (expected 'CODE:BINDING' with "
                        "1 <= CODE <= 19)\n");
        return EXIT_FAILURE;
      }
      n_keybindings++;
      break;
    case 'h':
      usage(stdout, argv[0]);
      return EXIT_SUCCESS;
    default:
      usage(stderr, argv[0]);
      return EXIT_FAILURE;
    }
  }
  if (optind != argc) {
    usage(stderr, argv[0]);
    return EXIT_FAILURE;
  }

  GVariant *result = NULL;
  GError *error = NULL;
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, &error);
  if (!bus) {
    g_printerr("failed to connect to session bus: %s\n", error->message);
    g_error_free(error);
    return EXIT_FAILURE;
  }

  State state = {
      .loop = g_main_loop_new(NULL, FALSE),
      .bus = bus,
      .exit_code = EXIT_FAILURE,
  };

  guint sub_selected = g_dbus_connection_signal_subscribe(
      bus, NULL, INTERFACE_NAME, "ItemSelected", OBJECT_PATH, NULL,
      G_DBUS_SIGNAL_FLAGS_NONE, on_item_selected, &state, NULL);
  guint sub_cancelled = g_dbus_connection_signal_subscribe(
      bus, NULL, INTERFACE_NAME, "Cancelled", OBJECT_PATH, NULL,
      G_DBUS_SIGNAL_FLAGS_NONE, on_cancelled, &state, NULL);
  guint sub_error = g_dbus_connection_signal_subscribe(
      bus, NULL, INTERFACE_NAME, "Error", OBJECT_PATH, NULL,
      G_DBUS_SIGNAL_FLAGS_NONE, on_error, &state, NULL);

  result = g_dbus_connection_call_sync(
      bus, BUS_NAME, OBJECT_PATH, INTERFACE_NAME, "SetPrompt",
      g_variant_new("(sb)", prompt, allow_custom), NULL, G_DBUS_CALL_FLAGS_NONE,
      -1, NULL, &error);
  if (!result) {
    g_printerr("SetPrompt failed: %s\n", error->message);
    goto cleanup;
  }
  g_variant_unref(result);

  for (size_t i = 0; i < n_keybindings; i++) {
    result = g_dbus_connection_call_sync(
        bus, BUS_NAME, OBJECT_PATH, INTERFACE_NAME, "SetKeyBinding",
        g_variant_new("(is)", keybindings[i].code, keybindings[i].binding),
        NULL, G_DBUS_CALL_FLAGS_NONE, -1, NULL, &error);
    if (!result) {
      g_printerr("SetKeyBinding failed: %s\n", error->message);
      goto cleanup;
    }
    g_variant_unref(result);
  }

  GIOChannel *stdin_channel = g_io_channel_unix_new(STDIN_FILENO);
  g_io_add_watch(stdin_channel, G_IO_IN | G_IO_HUP, on_stdin_ready, &state);
  g_io_channel_unref(stdin_channel);

  g_main_loop_run(state.loop);

cleanup:
  g_dbus_connection_signal_unsubscribe(bus, sub_selected);
  g_dbus_connection_signal_unsubscribe(bus, sub_cancelled);
  g_dbus_connection_signal_unsubscribe(bus, sub_error);
  g_main_loop_unref(state.loop);
  g_object_unref(bus);
  g_error_free(error);

  return state.exit_code;
}
