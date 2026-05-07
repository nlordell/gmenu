// SPDX-License-Identifier: GPL-3.0-only

#include <gio/gio.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#define BUS_NAME "org.gnome.Shell.Extensions.GMenu"
#define OBJECT_PATH "/org/gnome/Shell/Extensions/GMenu"
#define INTERFACE_NAME "org.gnome.Shell.Extensions.GMenu"

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
  GVariantIter *iter = NULL;
  g_variant_get(parameters, "(as)", &iter);
  const gchar *item;
  while (g_variant_iter_loop(iter, "&s", &item)) {
    puts(item);
  }
  g_variant_iter_free(iter);

  state->exit_code = EXIT_SUCCESS;
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

static gboolean on_stdin_ready(GIOChannel *channel, GIOCondition cond,
                               gpointer user_data) {
  (void)cond;
  State *state = user_data;

  gchar *line = NULL;
  gsize len = 0;
  GError *error = NULL;
  GIOStatus status =
      g_io_channel_read_line(channel, &line, &len, NULL, &error);

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

static void usage(FILE *out, const char *prog) {
  fprintf(out, "usage: %s [-p prompt]\n", prog);
}

int main(int argc, char **argv) {
  const char *prompt = ">";

  int opt;
  while ((opt = getopt(argc, argv, "p:h")) != -1) {
    switch (opt) {
    case 'p':
      prompt = optarg;
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

  GVariant *result = g_dbus_connection_call_sync(
      bus, BUS_NAME, OBJECT_PATH, INTERFACE_NAME, "SetPrompt",
      g_variant_new("(s)", prompt), NULL, G_DBUS_CALL_FLAGS_NONE, -1, NULL,
      &error);
  if (!result) {
    g_printerr("SetPrompt failed: %s\n", error->message);
    g_error_free(error);
    goto cleanup;
  }
  g_variant_unref(result);

  GIOChannel *stdin_channel = g_io_channel_unix_new(STDIN_FILENO);
  g_io_add_watch(stdin_channel, G_IO_IN | G_IO_HUP, on_stdin_ready, &state);
  g_io_channel_unref(stdin_channel);

  g_main_loop_run(state.loop);

cleanup:
  g_dbus_connection_signal_unsubscribe(bus, sub_selected);
  g_dbus_connection_signal_unsubscribe(bus, sub_cancelled);
  g_main_loop_unref(state.loop);
  g_object_unref(bus);

  return state.exit_code;
}
