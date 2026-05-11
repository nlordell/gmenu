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
 * @property {Map<number, string>} keyBindings
 */

class GMenuUI {
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
   * @param {string} item
   */
  appendItem(item) {
    this._ensureActors();
    this._rows?.add_child(
      new St.Label({
        style_class: "gmenu-row",
        text: item,
        x_expand: true,
      }),
    );
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
    this._ui = new GMenuUI();
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
      keyBindings: new Map(),
    };
    this._ui?.show(prompt);
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
    this._ui?.appendItem(item);
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
