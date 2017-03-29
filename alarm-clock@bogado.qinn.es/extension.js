/**
 * alarm-clock
 * ===========
 * > gnome-shell-alarm
 *
 * Gnome shell extension to show current active alarms on panel.
 *
 * Author: [pacoqueen@gmail.com](mailto:pacoqueen@gmail.com)
 * License: GPLv3.
 * Requires gnome-clocks (`sudo apt install org.gnome.clocks`).
 */

const St = imports.gi.St;
const Main = imports.ui.main;
const Lang = imports.lang;
const Clutter = imports.gi.Clutter;
const PanelMenu = imports.ui.panelMenu;
const Util = imports.misc.util;
const Gio = imports.gi.Gio;

// i10n i18n
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Gettext = imports.gettext;
Gettext.textdomain(Me.metadata['gettext-domain']);
Gettext.bindtextdomain(Me.metadata['gettext-domain'], Me.path + "/locale");
const _ = Gettext.gettext;

const DEFAULT_TEXT = _("Alarms");
const DEBUG = false;

let acMenu;             // Botón de la extensión.
let clock_settings;     // Configuración de dconf donde se guardan las alarmas.
let _alarm_changed_id;  // Callback señal cambio alarmas. Se debe desconectar
                        // al desactivar la extensión.

function _showAlarms(){
    /*
     * Abre la ventana de gnome.org.clocks, donde se pueden ver y editar las
     * alarmas, a través  de dbus.
     */
    log("Ejecutando org.gnome.clocks...");
    // Util.spawn(['/usr/bin/gnome-clocks']);
    const MyClockIface = '<node>\
        <interface name="org.freedesktop.Application">\
            <method name="Activate">\
                <arg type="a{sv}" name="platform-data" direction="in">\
                </arg>\
            </method>\
        </interface>\
    </node>';
    const MyClockProxy = Gio.DBusProxy.makeProxyWrapper(MyClockIface);
    let instance = new MyClockProxy(Gio.DBus.session, 'org.gnome.clocks',
                                    '/org/gnome/clocks');
    instance.ActivateRemote(function(result, error){
        log(result);
        log(error);
    });
}

function get_str_day(day) {
    /*
     * Devuelve el nombre del día correspondiente al número recibido. 7 = dom.
     */
    switch (day) {
        case 1:
            str_day = _("mon");
            break;
        case 2:
            str_day = _("tue");
            break;
        case 3:
            str_day = _("wed");
            break;
        case 4:
            str_day = _("thu");
            break;
        case 5:
            str_day = _("fri");
            break;
        case 6:
            str_day = _("sat");
            break;
        case 7:
            str_day = _("sun");
            break;
        default:
            str_day = "";
    }
    return str_day;
}

function find_next_alarm(){
    /*
     * Encuentra la siguiente alarma **activa** y devuelve el nombre junto con
     * la hora en una cadena.
     */
    str_alarm = DEFAULT_TEXT;
    menor_dif = null;
    alarms = clock_settings.get_value("alarms");
    alarmas = alarms.deep_unpack();
    hoy = new Date();
    dia = hoy.getDay();  // Porque clocks guarda lunes = 1, dom = 7:
    if (dia == 0){
        dia = 7;
    }
    hora = hoy.getHours();
    minutos = hoy.getMinutes();
    for (i=0; i<alarmas.length; ++i){
        alarma = alarmas[i];
        // Solo para las alarmas activas...
        if (alarma.active.unpack()){
            // y para cada uno de los días en que está programada la alarma...
            for (j=0; j<alarma.days.unpack().length; j++){
                a_dia = alarma.days.unpack()[j].unpack();
                a_hora = alarma.hour.unpack();
                a_minutos = alarma.minute.unpack();
                // Diferencia en minutos en positivo hasta las alarmas futuras
                // o en negativo para las que ya han pasado y se repetirán.
                dif = (((a_dia - dia) * 24 * 60)
                        +((a_hora - hora) * 60)
                        +(a_minutos - minutos));
                if (DEBUG){
                    log(alarma.name.unpack() + " [" + a_dia + "·" + a_hora + ":"
                        + a_minutos + "]: " + dif + " (" + menor_dif + ")");
                }
                if ((menor_dif == null)
                        || (menor_dif < 0 && dif >= 0)
                        || (menor_dif > 0 && dif >= 0 && dif < menor_dif)
                        || (menor_dif < 0 && dif < 0 && dif > menor_dif)){
                    // La primera alarma activa, pasada o futura, siempre será la
                    // próxima hasta encontrar una mejor. Pero las futuras tienen
                    // preferencia sobre las pasadas una vez encuentre la primera.
                    menor_dif = dif
                    pad = "00";
                    str_minute = alarma.minute.unpack().toString();
                    str_hora = (alarma.hour.unpack() + ":"
                                + pad.substring(0, pad.length - str_minute.length)
                                + str_minute);
                    if (a_dia == dia){
                        str_day = "";
                    } else {
                        str_day = get_str_day(a_dia) + " ";
                    }
                    clock_symbol = "⌚";
                    str_alarm = (clock_symbol + " " + alarma.name.unpack()
                                 + " [" + str_day + str_hora + "]");
                    if (DEBUG) log(str_alarm);
                }
            }
        }
    }
    return str_alarm;
}

const AlarmIndicator = new Lang.Class({
    /*
     * Clase que encapsula el botón de la extensión, que al pulsarlo mostrará
     * la ventana de org.gnome.clocks, y en el texto del botón se verá
     * la siguiente alarma activa en sonar.
     */
    Name: 'AlarmIndicator',
    Extends: PanelMenu.Button,

    _init: function (){
        /*
         * Inicialización de la extensión. Crea el botón con un texto por
         * defecto y asocia la función al callback de pulsarlo con el ratón.
         */
        this.parent(0.0, "Alarm indicator", false);
        this.buttonText = new St.Bin({
            style_class: 'panel-button',
            reactive: true,
            can_focus: true,
            x_fill: true,
            y_fill: false,
            track_hover: true
        });
        this.label = new St.Label({
            text: DEFAULT_TEXT,
            y_align: Clutter.ActorAlign.CENTER
        });
        this.buttonText.set_child(this.label);
        this.actor.add_actor(this.buttonText);
        this.buttonText.connect('button-press-event', _showAlarms);
        this._update_button();
        this._connect_clocks_signal();
        if (DEBUG) log("Alarm Clock: Inicialización completa");
    },

    _update_button: function (){
        /*
         * Actualiza el texto del botón mostrando la siguiente alarma que
         * sonará.
         */
        if (DEBUG) log("_update_button");
        str_next_alarm = find_next_alarm();
        if (DEBUG) log(" → " + str_next_alarm);
        this.label.set_text(str_next_alarm);
    },

    _connect_clocks_signal: function (){
        /*
         * Conecta la señal que se activa al cambiar alguna clave de la
         * configuración vía Gio.Settings con el callback que actualizará
         * la alarma mostrada en el botón (si fuese necesario).
         * org.gnome.clocks no proporciona ninguna señal por dbus.
         */
        _alarm_changed_id = clock_settings.connect('changed::alarms',
                                                   Lang.bind(this,
                                                             this._update_button));
    }
});

function show_alarms_in_debuglog() {
    /*
     * Muestra las alarmas en la consula de depuración. Se puede ver con:
     * `sudo journalctl /usr/bin/gnome-shell -f -o cat`
     */

    alarms = clock_settings.get_value("alarms");
    alarmas = alarms.deep_unpack();
    for (i=0; i<alarmas.length; ++i){
        alarma = alarmas[i];
        activa = alarma.active.unpack();
        if (activa){
            str_activa = '✔';
        } else {
            str_activa = '✘';
        }
        pad = "00";
        str_minute = alarma.minute.unpack().toString();
        hora = (alarma.hour.unpack() + ":"
                + pad.substring(0, pad.length - str_minute.length) + str_minute);
        dias = alarma.days.unpack();
        var str_dias = "";
        for (j=0; j<dias.length; j++){
            str_dias = str_dias + get_str_day(dias[j].unpack()) + " ";
        }
        str_alarma = (alarma.name.unpack() + " a las " + hora + " los "
                      + str_dias + " " + str_activa);
        log(str_alarma);
    }
}

function init() {
    /*
     * Inicialización de la extensión. Se leen las alarmas de gsettings.
     */
    clock_settings = new Gio.Settings({schema: "org.gnome.clocks"});
    if (DEBUG){
        show_alarms_in_debuglog();
    }
}

function enable() {
    /*
     * Activación de la extensión. Es donde se crea el botón.
     */
    if (DEBUG) log("Alarm Clock: Activando extensión...");
    acMenu = new AlarmIndicator;
    Main.panel.addToStatusArea('alarm-indicator', acMenu);
}

function disable() {
    /*
     * Extensión desactivada, elimino el objeto y todo caerá detrás.
     */
    clock_settings.disconnect(_alarm_changed_id);
    acMenu.destroy();
    if (DEBUG) log("Alarm Clock: Desactivación completada.");
}
