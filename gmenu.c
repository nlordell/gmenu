// SPDX-License-Identifier: GPL-3.0-only

#include <gio/gio.h>
#include <stdio.h>
#include <stdlib.h>

#define BUS_NAME "org.gnome.Shell.Extensions.GMenu"
#define OBJECT_PATH "/org/gnome/Shell/Extensions/GMenu"
#define INTERFACE_NAME "org.gnome.Shell.Extensions.GMenu"

typedef struct {
  GMainLoop *loop;
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

static GPtrArray *read_stdin_lines(void) {
  GPtrArray *items = g_ptr_array_new_with_free_func(g_free);
  char *line = NULL;
  size_t cap = 0;
  ssize_t len;
  while ((len = getline(&line, &cap, stdin)) != -1) {
    while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r')) {
      line[--len] = '\0';
    }
    g_ptr_array_add(items, g_strdup(line));
  }
  free(line);
  return items;
}

int main(int argc, char **argv) {
  const char *prompt = (argc > 1) ? argv[1] : ">";

  GPtrArray *items = read_stdin_lines();

  GError *error = NULL;
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, &error);
  if (!bus) {
    g_printerr("failed to connect to session bus: %s\n", error->message);
    g_error_free(error);
    g_ptr_array_free(items, TRUE);
    return EXIT_FAILURE;
  }

  State state = {
      .loop = g_main_loop_new(NULL, FALSE),
      .exit_code = EXIT_FAILURE,
  };

  guint sub_selected = g_dbus_connection_signal_subscribe(
      bus, NULL, INTERFACE_NAME, "ItemSelected", OBJECT_PATH, NULL,
      G_DBUS_SIGNAL_FLAGS_NONE, on_item_selected, &state, NULL);
  guint sub_cancelled = g_dbus_connection_signal_subscribe(
      bus, NULL, INTERFACE_NAME, "Cancelled", OBJECT_PATH, NULL,
      G_DBUS_SIGNAL_FLAGS_NONE, on_cancelled, &state, NULL);

  GVariantBuilder builder;
  g_variant_builder_init(&builder, G_VARIANT_TYPE("as"));
  for (guint i = 0; i < items->len; i++) {
    g_variant_builder_add(&builder, "s", (const char *)items->pdata[i]);
  }

  GVariant *result = g_dbus_connection_call_sync(
      bus, BUS_NAME, OBJECT_PATH, INTERFACE_NAME, "Show",
      g_variant_new("(ass)", &builder, prompt), NULL, G_DBUS_CALL_FLAGS_NONE,
      -1, NULL, &error);
  if (!result) {
    g_printerr("Show failed: %s\n", error->message);
    g_error_free(error);
    goto cleanup;
  }
  g_variant_unref(result);

  g_main_loop_run(state.loop);

cleanup:
  g_dbus_connection_signal_unsubscribe(bus, sub_selected);
  g_dbus_connection_signal_unsubscribe(bus, sub_cancelled);
  g_main_loop_unref(state.loop);
  g_object_unref(bus);
  g_ptr_array_free(items, TRUE);

  return state.exit_code;
}
