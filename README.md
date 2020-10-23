alarm-clock
===========

> gnome-shell-alarm

Gnome shell extension to show current active alarms on panel.

Author: ✉ [pacoqueen@gmail.com](mailto:pacoqueen@gmail.com); ↪ [http://www.qinn.es](http://www.qinn.es)

License: GPLv3.

Requires gnome-clocks (`sudo apt install org.gnome.clocks`).

![screenshot](https://raw.githubusercontent.com/pacoqueen/gnome-shell-alarm/master/screenshot.png "Screenshot")

## Installation

Download _zip_ and install using **gnome-tweak-tool** (`sudo apt install gnome-tweak-tool`) or *unzip* it on `~/.local/share/gnome-shell/extensions`.

It can be installed too using [extensions.gnome.org](https://extensions.gnome.org/extension/1192/alarm-clock/).

## Usage

Load extension and see. It simply shows the next active alarm on panel.
Not configurable by the moment.

* Click to open Gnome Clocks and set, delete or create new alarms.

## Troubleshooting

If extension does not work, try to restart gnome-shell pressing `Alt+F2` and then type `r` and `ENTER`. Try to restart session too.

If nothing works, check error status by pressing `Alt+F2` and typing `lg` (`ENTER`). Go to Extensions tab and press _Show Errors_ on _Alarm Clock_. It could be useful filling a [issue report](https://github.com/pacoqueen/gnome-shell-alarm/issues).

Hint: You can get gnome-shell log by `sudo journalctl /usr/bin/gnome-shell -f -o cat` and reload the extension with [Gnome Shell Extension Reloader](https://extensions.gnome.org/extension/1137/gnome-shell-extension-reloader/) with no need to fully restart gnome-shell.
