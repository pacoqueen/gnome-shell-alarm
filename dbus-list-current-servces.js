#!/usr/bin/env gjs

// run : gjs dbus-list-current-services.js 2>/dev/null | sort -t, -k2,3r | column -s, -t
// Taken from https://gist.githubusercontent.com/mohan43u/2317b6a54d23538fd8d4/raw/ed4683d3da081e5cd668efeb99889ce0a5ff043d/dbus-list-current-servces.js

const Lang = imports.lang;
const Gio = imports.gi.Gio;
const Format = imports.format;
const cmdline = "dbus-send --%s --dest=%s --type=method_call --print-reply %s org.freedesktop.DBus.Introspectable.Introspect";

const Subprocess = new Lang.Class({
    Name: "Subprocess",
    _getoutput: function(stream) {
	let buffer = null;
	while(true) {
	    let buffertemp = stream.read_bytes(512 * 1, null).unref_to_array();
	    if(buffertemp.length == 0) break;
	    if(buffer == null) {
		buffer = buffertemp;
	    }
	    else {
		buffer += buffertemp;
	    }
	}
	return buffer ? buffer.toString() : buffer;
    },
    run: function(cmdlinev) {
	this.subprocess = Gio.Subprocess.new(cmdlinev,
					     Gio.SubprocessFlags.STDOUT_PIPE |
					     Gio.SubprocessFlags.STDERR_PIPE);
	this.subprocess.wait(null);
	this.stdout = this._getoutput(this.subprocess.get_stdout_pipe());
	this.stderr = this._getoutput(this.subprocess.get_stderr_pipe());
	return this.subprocess.get_exit_status();
    }
});

const DBusNodeXml = new Lang.Class({
    Name: "DBusNodeXml",
    _init: function() {
	String.prototype.format = Format.format;
    },
    getxml: function(bustype, dest, path) {
	let stream = null;
	let subprocess = new Subprocess();
	let status = subprocess.run(cmdline.format(bustype, dest, path).split(" "));
	let nodexml = subprocess.stdout;
	nodexml = nodexml.substring(nodexml.search(/<!DOCTYPE/), nodexml.length - 3);
	return [status, nodexml];
    }
});

const DBusProxy = new Lang.Class({
    Name: "DBusProxy",
    _init: function() {
	this.dbusnodexml = new DBusNodeXml();
    },
    getproxyclass: function(bustype, dest, path) {
	let proxyclass = Gio.DBusProxy.makeProxyWrapper(this.dbusnodexml.getxml(bustype, dest, path)[1]);
	return proxyclass;
    }
});

function main(args) {
    let dbusproxy = new DBusProxy();
    for(let bus of ["system", "session"]) {
	let proxyclass = dbusproxy.getproxyclass(bus,
						 "org.freedesktop.DBus",
						 "/org/freedesktop/dbus");
	let proxy = new proxyclass(bus == "system" ? Gio.DBus.system : Gio.DBus.session,
				   "org.freedesktop.DBus",
				   "/org/freedesktop/dbus");
	proxy.ListNamesSync()[0].forEach(function(e, i, a) {
	    try {
		let pid = proxy.GetConnectionUnixProcessIDSync(e);
		let subprocess = new Subprocess();
		subprocess.run("ps p %d h o args".format(pid).split(" "));
		print("%d,%s,%s,%s".format(pid, bus, e, subprocess.stdout.trim()));
	    }
	    catch(e) {
		printerr(e);
	    }
	});
    }
}

main(ARGV);
