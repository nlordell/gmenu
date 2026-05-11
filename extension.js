// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Nicholas Rodrigues Lordello

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

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

  enable() {
    this._service = new GMenuService(this);
    this._service.export();
  }

  disable() {
    if (this._session !== null) {
      this._service?.emitCancelled();
      this._session = null;
    }

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
