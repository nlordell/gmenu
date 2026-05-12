// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Nicholas Rodrigues Lordello

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import Clutter from "gi://Clutter";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const BUS_NAME = "org.gnome.Shell.Extensions.GMenu";
const OBJECT_PATH = "/org/gnome/Shell/Extensions/GMenu";

const DBUS_INTERFACE = `
<node>
  <interface name="org.gnome.Shell.Extensions.GMenu">
    <method name="SetPrompt">
      <arg name="prompt" type="s" direction="in"/>
      <arg name="allowCustom" type="b" direction="in"/>
    </method>
    <method name="SetKeyBinding">
      <arg name="code" type="i" direction="in"/>
      <arg name="accelerator" type="s" direction="in"/>
    </method>
    <method name="ListItem">
      <arg name="item" type="s" direction="in"/>
    </method>
    <signal name="ItemSelected">
      <arg name="code" type="i"/>
      <arg name="item" type="s"/>
    </signal>
    <signal name="Cancelled"/>
    <signal name="Error">
      <arg name="message" type="s"/>
    </signal>
  </interface>
</node>`;

/**
 * @typedef {object} Session
 * @property {string} prompt
 * @property {boolean} allowCustom
 * @property {string[]} items
 * @property {string[]} filteredItems
 * @property {string} query
 * @property {number} selectedIndex
 * @property {Map<number, string>} keyBindings
 */

class GMenuUI {
  /** @type {GMenuExtension} */
  _extension;

  /** @type {St.BoxLayout | null} */
  _root = null;

  /** @type {St.Label | null} */
  _promptLabel = null;

  /** @type {St.Entry | null} */
  _entry = null;

  /** @type {St.BoxLayout | null} */
  _rows = null;

  /** @type {Clutter.Grab | null} */
  _grab = null;

  /**
   * @param {GMenuExtension} extension
   */
  constructor(extension) {
    this._extension = extension;
  }

  /**
   * @param {string} prompt
   */
  show(prompt) {
    this._ensureActors();
    this.clearItems();

    this._promptLabel?.set_text(prompt);
    this._entry?.set_text("");
    this._positionRoot();
    this._attachRoot();
    this._focusEntry();
  }

  /**
   * @param {string[]} items
   * @param {number} selectedIndex
   */
  renderItems(items, selectedIndex) {
    this._ensureActors();

    if (this._rows === null) {
      return;
    }

    this._rows.remove_all_children();

    for (let i = 0; i < items.length; i++) {
      const row = new St.Label({
        style_class: "gmenu-row",
        text: items[i],
        x_expand: true,
      });
      if (i === selectedIndex) {
        row.add_style_class_name("gmenu-row-selected");
      }
      this._rows.add_child(row);
    }
  }

  clearItems() {
    this._rows?.remove_all_children();
  }

  hide() {
    if (this._grab !== null) {
      Main.popModal(this._grab);
      this._grab = null;
    }

    if (this._root !== null && this._root.get_parent() !== null) {
      Main.layoutManager.uiGroup.remove_child(this._root);
    }
  }

  destroy() {
    this.hide();
    this._root?.destroy();
    this._root = null;
    this._promptLabel = null;
    this._entry = null;
    this._rows = null;
  }

  _ensureActors() {
    if (this._root !== null) {
      return;
    }

    this._root = new St.BoxLayout({
      style_class: "gmenu-root",
      vertical: true,
      reactive: true,
      x_expand: true,
      y_expand: true,
    });

    const inputRow = new St.BoxLayout({
      style_class: "gmenu-input-row",
      vertical: false,
      x_expand: true,
    });

    this._promptLabel = new St.Label({
      style_class: "gmenu-prompt",
      y_align: Clutter.ActorAlign.CENTER,
    });

    this._entry = new St.Entry({
      style_class: "gmenu-input",
      can_focus: true,
      x_expand: true,
    });
    this._entry.get_clutter_text().connect("text-changed", () => {
      this._extension.updateQuery(this._entry?.get_text() ?? "");
    });
    this._entry.get_clutter_text().connect("key-press-event", (_, event) =>
      this._extension.handleKeyPress(event),
    );

    this._rows = new St.BoxLayout({
      style_class: "gmenu-rows",
      vertical: true,
      x_expand: true,
    });

    inputRow.add_child(this._promptLabel);
    inputRow.add_child(this._entry);
    this._root.add_child(inputRow);
    this._root.add_child(this._rows);
  }

  _positionRoot() {
    if (this._root === null) {
      return;
    }

    const monitor = Main.layoutManager.primaryMonitor;
    if (monitor !== null) {
      this._root.set_position(monitor.x, monitor.y);
      this._root.set_size(monitor.width, monitor.height);
    } else {
      this._root.set_position(0, 0);
      this._root.set_size(global.stage.width, global.stage.height);
    }
  }

  _attachRoot() {
    if (this._root === null || this._root.get_parent() !== null) {
      return;
    }

    Main.layoutManager.uiGroup.add_child(this._root);
    this._grab = Main.pushModal(this._root);
  }

  _focusEntry() {
    if (this._entry === null) {
      return;
    }

    global.stage.set_key_focus(this._entry);
    this._entry.grab_key_focus();
  }
}

/**
 * @param {string[]} items
 * @param {string} query
 * @returns {string[]}
 */
function filterItems(items, query) {
  const normalizedQuery = query.toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return [...items];
  }

  /** @type {{ item: string, index: number, score: number }[]} */
  const scoredItems = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const score = matchScore(item, normalizedQuery);
    if (score !== null) {
      scoredItems.push({ item, index, score });
    }
  }

  return scoredItems
    .sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

/**
 * @param {string} item
 * @param {string} normalizedQuery
 * @returns {number | null}
 */
function matchScore(item, normalizedQuery) {
  const normalizedItem = item.toLocaleLowerCase();
  if (normalizedItem.startsWith(normalizedQuery)) {
    return normalizedItem.length;
  }

  const substringIndex = normalizedItem.indexOf(normalizedQuery);
  if (substringIndex !== -1) {
    return 1000 + substringIndex * 10 + normalizedItem.length;
  }

  let queryIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;

  for (let itemIndex = 0; itemIndex < normalizedItem.length; itemIndex++) {
    if (normalizedItem[itemIndex] !== normalizedQuery[queryIndex]) {
      continue;
    }

    if (firstMatch === -1) {
      firstMatch = itemIndex;
    }
    lastMatch = itemIndex;
    queryIndex++;

    if (queryIndex === normalizedQuery.length) {
      return 2000 + (lastMatch - firstMatch) * 10 + firstMatch;
    }
  }

  return null;
}

class GMenuService {
  /** @type {GMenuExtension} */
  _extension;

  /** @type {Gio.DBusExportedObject} */
  _dbusImpl;

  /** @type {Gio.DBusConnection | null} */
  _connection = null;

  _ownerId = 0;

  /**
   * @param {GMenuExtension} extension
   */
  constructor(extension) {
    this._extension = extension;
    this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(DBUS_INTERFACE, this);
  }

  /**
   * @param {string} prompt
   * @param {boolean} allowCustom
   */
  SetPrompt(prompt, allowCustom) {
    this._extension.startSession(prompt, allowCustom);
  }

  /**
   * @param {number} code
   * @param {string} accelerator
   */
  SetKeyBinding(code, accelerator) {
    this._extension.setKeyBinding(code, accelerator);
  }

  /**
   * @param {string} item
   */
  ListItem(item) {
    this._extension.listItem(item);
  }

  /**
   * @param {number} code
   * @param {string} item
   */
  emitItemSelected(code, item) {
    this._dbusImpl.emit_signal(
      "ItemSelected",
      GLib.Variant.new("(is)", [code, item]),
    );
  }

  emitCancelled() {
    this._dbusImpl.emit_signal("Cancelled", GLib.Variant.new("()", []));
  }

  /**
   * @param {string} message
   */
  emitError(message) {
    this._dbusImpl.emit_signal("Error", GLib.Variant.new("(s)", [message]));
  }

  export() {
    if (this._connection !== null) {
      return;
    }

    this._connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
    this._dbusImpl.export(this._connection, OBJECT_PATH);
    this._ownerId = Gio.bus_own_name_on_connection(
      this._connection,
      BUS_NAME,
      Gio.BusNameOwnerFlags.NONE,
      null,
      null,
    );
  }

  unexport() {
    if (this._ownerId !== 0) {
      Gio.bus_unown_name(this._ownerId);
      this._ownerId = 0;
    }

    if (this._connection !== null) {
      this._dbusImpl.unexport();
      this._connection = null;
    }
  }
}

export default class GMenuExtension extends Extension {
  /** @type {GMenuService | null} */
  _service = null;

  /** @type {Session | null} */
  _session = null;

  /** @type {GMenuUI | null} */
  _ui = null;

  enable() {
    this._service = new GMenuService(this);
    this._ui = new GMenuUI(this);
    this._service.export();
  }

  disable() {
    if (this._session !== null) {
      this._service?.emitCancelled();
      this._session = null;
    }

    this._ui?.destroy();
    this._ui = null;
    this._service?.unexport();
    this._service = null;
  }

  /**
   * @param {string} prompt
   * @param {boolean} allowCustom
   */
  startSession(prompt, allowCustom) {
    this._session = {
      prompt,
      allowCustom,
      items: [],
      filteredItems: [],
      query: "",
      selectedIndex: -1,
      keyBindings: new Map(),
    };
    this._ui?.show(prompt);
    this._renderSession();
  }

  /**
   * @param {number} code
   * @param {string} accelerator
   */
  setKeyBinding(code, accelerator) {
    const session = this._requireSession("SetKeyBinding");
    if (session === null) {
      return;
    }

    session.keyBindings.set(code, accelerator);
  }

  /**
   * @param {string} item
   */
  listItem(item) {
    const session = this._requireSession("ListItem");
    if (session === null) {
      return;
    }

    session.items.push(item);
    this._refilterSession(false);
    this._renderSession();
  }

  /**
   * @param {string} query
   */
  updateQuery(query) {
    const session = this._session;
    if (session === null) {
      return;
    }

    if (session.query === query) {
      return;
    }

    session.query = query;
    this._refilterSession(true);
    this._renderSession();
  }

  /**
   * @param {Clutter.Event} event
   * @returns {boolean}
   */
  handleKeyPress(event) {
    const symbol = event.get_key_symbol();

    switch (symbol) {
      case Clutter.KEY_Escape:
        this._cancelSession();
        return Clutter.EVENT_STOP;
      case Clutter.KEY_Return:
      case Clutter.KEY_KP_Enter:
      case Clutter.KEY_ISO_Enter:
        this._acceptSession(0);
        return Clutter.EVENT_STOP;
      case Clutter.KEY_Up:
        this._moveSelection(-1);
        return Clutter.EVENT_STOP;
      case Clutter.KEY_Down:
        this._moveSelection(1);
        return Clutter.EVENT_STOP;
      case Clutter.KEY_Home:
        this._selectBoundary(0);
        return Clutter.EVENT_STOP;
      case Clutter.KEY_End:
        this._selectBoundary(-1);
        return Clutter.EVENT_STOP;
      case Clutter.KEY_Page_Up:
        this._moveSelection(-10);
        return Clutter.EVENT_STOP;
      case Clutter.KEY_Page_Down:
        this._moveSelection(10);
        return Clutter.EVENT_STOP;
      default:
        return Clutter.EVENT_PROPAGATE;
    }
  }

  /**
   * @param {number} delta
   */
  _moveSelection(delta) {
    const session = this._session;
    if (session === null || session.filteredItems.length === 0) {
      return;
    }

    session.selectedIndex = Math.max(
      0,
      Math.min(session.filteredItems.length - 1, session.selectedIndex + delta),
    );
    this._renderSession();
  }

  /**
   * @param {number} boundary
   */
  _selectBoundary(boundary) {
    const session = this._session;
    if (session === null || session.filteredItems.length === 0) {
      return;
    }

    session.selectedIndex =
      boundary === 0 ? 0 : session.filteredItems.length - 1;
    this._renderSession();
  }

  /**
   * @param {number} code
   */
  _acceptSession(code) {
    const session = this._session;
    if (session === null) {
      return;
    }

    const item = this._selectedItem(session);
    if (item === null) {
      return;
    }

    this._session = null;
    this._ui?.hide();
    this._service?.emitItemSelected(code, item);
  }

  _cancelSession() {
    if (this._session === null) {
      return;
    }

    this._session = null;
    this._ui?.hide();
    this._service?.emitCancelled();
  }

  /**
   * @param {Session} session
   * @returns {string | null}
   */
  _selectedItem(session) {
    if (
      session.selectedIndex >= 0 &&
      session.selectedIndex < session.filteredItems.length
    ) {
      return session.filteredItems[session.selectedIndex];
    }

    if (session.allowCustom) {
      return session.query;
    }

    return null;
  }

  /**
   * @param {boolean} resetSelection
   */
  _refilterSession(resetSelection) {
    const session = this._session;
    if (session === null) {
      return;
    }

    const selectedItem =
      session.selectedIndex >= 0
        ? session.filteredItems[session.selectedIndex]
        : null;
    session.filteredItems = filterItems(session.items, session.query);

    if (session.filteredItems.length === 0) {
      session.selectedIndex = -1;
    } else if (resetSelection || selectedItem === null) {
      session.selectedIndex = 0;
    } else {
      const nextSelectedIndex = session.filteredItems.indexOf(selectedItem);
      session.selectedIndex =
        nextSelectedIndex === -1
          ? Math.min(session.selectedIndex, session.filteredItems.length - 1)
          : nextSelectedIndex;
    }
  }

  _renderSession() {
    const session = this._session;
    if (session === null) {
      this._ui?.renderItems([], -1);
      return;
    }

    this._ui?.renderItems(session.filteredItems, session.selectedIndex);
  }

  /**
   * @param {string} method
   * @returns {Session | null}
   */
  _requireSession(method) {
    if (this._session !== null) {
      return this._session;
    }

    this._service?.emitError(`${method} called before SetPrompt`);
    return null;
  }
}
