# `gmenu`

A `dmenu`-compatible replacement as a GNOME shell extension.

GNOME famously refuses to implement the layer shell Wayland protocol. This means that almost all of your favourite menu pickers (such as Fuzzel and Rofi) do not work on GNOME. The GNOME developers stance is that such a feature should be developed as a shall extension, and so here it is. The implementation is split into two parts:

1. A shell extension that displays the options with a fuzzy search menu
2. A command line tool for communicating with the extension over D-Bus

## Building

```sh
make
make install
```
