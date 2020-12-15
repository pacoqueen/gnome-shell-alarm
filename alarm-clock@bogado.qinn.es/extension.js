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
const Mainloop = imports.mainloop;

// i10n i18n
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Gettext = imports.gettext;
Gettext.textdomain(Me.metadata['gettext-domain']);
Gettext.bindtextdomain(Me.metadata['gettext-domain'], Me.path + "/locale");
const _ = Gettext.gettext;

const DEFAULT_TEXT = _("Alarms");
const DEBUG = false;

var timeout;            // Callback para la actualización cada minuto.
let acMenu;             // Botón de la extensión.
let clock_settings;     // Configuración de dconf donde se guardan las alarmas.
let _alarm_changed_id;  // Callback señal cambio alarmas. Se debe desconectar
                        // al desactivar la extensión.
var org_gnome_clocks=false;  // Si no está instalado el 'new Gio.Settings' peta.

function _showAlarms(minimized=false){
    /*
     * Abre la ventana de gnome.org.clocks, donde se pueden ver y editar las
     * alarmas, a través  de dbus.
     */
    if ( ! org_gnome_clocks ){
        if (DEBUG) log("org.gnome.clocks no instalado.");
    } else {
        // TODO: Si minimized es true, iniciar minimizado o minimizar tras iniciar. ¿Cómo? No lo sé. Por DBus no lo veo claro.
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
     * Encuentra la siguiente alarma **activa** y devuelve una tupla con:
     * el nombre de la alarma y la hora en una cadena, una tupla con el
     * día de la semana (en formato numérico), hora y minutos, y el tiempo
     * que falta hasta que suene.
     */
    str_alarm = DEFAULT_TEXT;
    var res = [str_alarm, null, null];
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
                if (dif < 0){ // Alarma pasada. Para simplificar comparaciones...
                    dif += (7 * 24 * 60);   // ... sumo una semana.
                }
                if (DEBUG){
                    log(alarma.name.unpack() + " [" + a_dia + "·" + a_hora + ":"
                        + a_minutos + "]: " + dif + " (" + menor_dif + ")");
                }
                if ((menor_dif == null)
                        || (menor_dif < 0 && dif >= 0)
                        || (dif < menor_dif)){
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
                    let clock_symbol = "⌚";
                    if (dif == 0){
                        clock_symbol = "⚠";
                    }
                    str_alarm = (clock_symbol + " " + alarma.name.unpack()
                                 + " [" + str_day + str_hora + "]");
                    if (DEBUG) log(str_alarm);
                    next_alarm = [a_dia, a_hora, a_minutos];
                    res = [str_alarm, next_alarm, menor_dif];
                }
            }
        }
    }
    return res;
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
            // x_fill: true,
            // y_fill: false,
            x_expand: true,
            y_expand: false,
            track_hover: true
        });
        this.label = new St.Label({
            text: DEFAULT_TEXT,
            y_align: Clutter.ActorAlign.CENTER
        });
        this.buttonText.set_child(this.label);
        this.add_actor(this.buttonText);
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
        if (clock_settings == null){
            var str_next_alarm = _("org.gnome.clocks not installed")
        } else {
            array_next_alarm = find_next_alarm();
            var str_next_alarm = array_next_alarm[0];
            var str_falta = minutes_to_string(array_next_alarm[2]);
        }
        if (str_falta) {
            if (DEBUG) log(" → (" + str_falta + ")" + str_next_alarm);
            this.label.set_text("(" + str_falta + ")" + str_next_alarm);
        } else {
            if (DEBUG) log(" → " + str_next_alarm);
            this.label.set_text(str_next_alarm);
        }
    },

    _connect_clocks_signal: function (){
        /*
         * Conecta la señal que se activa al cambiar alguna clave de la
         * configuración vía Gio.Settings con el callback que actualizará
         * la alarma mostrada en el botón (si fuese necesario).
         * org.gnome.clocks no proporciona ninguna señal por dbus.
         */
        if (clock_settings == null){
            if (DEBUG) log("org.gnome.clocks no instalado.")
        } else {
            _alarm_changed_id = clock_settings.connect('changed::alarms',
                                                       Lang.bind(this,
                                                        this._update_button));
        }
    }
});

function minutes_to_string(m) {
    /*
     * Convierte el número recibido (minutos) en una cadena del tipo 1d2h31m.
     */
    var res = "";
    if (m > 0) {
        dias = parseInt(m / (24*60));
        horas = parseInt((m / 60) % 24);
        minutos = m % 60;
        if (dias > 0) {
            res += dias + "d";
        }
        if (horas > 0) {
            res += horas + "h";
        }
        res += minutos + "m";
    }
    return res;
}

function show_alarms_in_debuglog(clock_settings) {
    /*
     * Muestra las alarmas en la consula de depuración. Se puede ver con:
     * `sudo journalctl /usr/bin/gnome-shell -f -o cat`
     */

    var activa;
    var str_activa;
    var dias;
    var str_alarma;
    var alarms;
    log("Alarm Clock: buscando alarmas...");
    if (clock_settings == null){
        log("Alarm Clock: org.gnome.clocks no instalado.");
    } else {
        alarms = clock_settings.get_value("alarms");
        alarmas = alarms.deep_unpack();
        for (var i=0; i<alarmas.length; ++i){
            alarma = alarmas[i];
            activa = alarma.active.unpack();
            // XXX: La versión 3.36 siempre devuelve que la alarma está activa aunque no lo esté.
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
}

function _refresh(){
    /*
     * Comprueba si la próxima alarma es en el siguiente minuto y lanza
     * org.gnome.clock **para que suene**. Si no está en memoria, aunque sea
     * minimizado. No suena la alarma.
     * Primero comprueba que la siguiente alarma no se ha cumplido ya, en cuyo
     * caso la cambia por la siguiente.
     */
    var str_active_alarm;
    var dif;
    if (clock_settings == null){
        if (DEBUG) log("Alarm Clock: org.gnome.clocks no instalado.");
        str_active_alarm = _("org.gnome.clocks not installed");
        next_alarm = null;
        str_next_alarm = "";
        dif = -1;
    } else {
        array_next_alarm = find_next_alarm();
        str_next_alarm = array_next_alarm[0];
        next_alarm = array_next_alarm[1];
        dif = array_next_alarm[2];
        str_active_alarm = acMenu.label.text;
    }
    if (str_active_alarm != str_next_alarm || dif == 0){
        if (next_alarm){
            acMenu._update_button();
        } else {
            acMenu._update_button();
        }
    }
    if (next_alarm != null){
        if (DEBUG) log(" >>>>>>>> next_alarm: " + next_alarm);
        if (DEBUG) log(" >>>>>>>> dif: " + dif);
        let process_id = dbus_get_process_id();
        if (DEBUG) log(" >>>>>>>>> > pid: " + process_id);
        if (dif >= 0 && dif <= 1){
            process_id = dbus_get_process_id();
            if (process_id == null){}
                _showAlarms(minimized=true);
        }
    }
}

function dbus_get_process_id(){
    /*
     * Obtiene a través de dbus el pid del proceso org.gnome.clocks o null si
     * no está iniciado.
     */
    let pid = null;
    const MyDBusIface = '<node>\
        <interface name="org.freedesktop.DBus">\
            <method name="GetConnectionUnixProcessID">\
                <arg type="s" name="name" direction="in">\
                </arg>\
                <arg type="u" name="pid" direction="out">\
                </arg>\
            </method>\
        </interface>\
    </node>';
    const MyDBusProxy = Gio.DBusProxy.makeProxyWrapper(MyDBusIface);
    let instance = new MyDBusProxy(Gio.DBus.session, 'org.freedesktop.DBus',
                                   '/org/freedesktop/DBus');
    try {
        pid = instance.GetConnectionUnixProcessIDSync('org.gnome.clocks');
    } catch (e) {
        log(e);
    }
    return pid;
}

function check_gsettings_schema(schema){
    /*
     * Returns true if schema is present on Gio schemas. False otherway.
     */
    var schemas = Gio.Settings.list_schemas();
    for (var i=0; i<schemas.length; i++){
        if (schemas[i] == schema){
            return true
        }
    }
    return false;
}

function check_for_clocks_instead_of_shaming_gio_crash_ty(){
    /*
     * Gio has an awuful way to tell me that org.gnome.clocks is not present
     * in current schemas: crashing entire session.
     * So this is only to check for org.gnome.clocks schema and returns true
     * if so or false if not.
     */
    return check_gsettings_schema("org.gnome.clocks");
}

function init() {
    /*
     * Inicialización de la extensión. Se leen las alarmas de gsettings.
     */
    if (DEBUG) log("Alarm Clock: Inicializando extensión. DEBUG activado.");
    org_gnome_clocks = check_for_clocks_instead_of_shaming_gio_crash_ty();
    if ( ! org_gnome_clocks ){
        if (DEBUG) log("Alarm Clock: org.gnome.clocks no instalado.");
        clock_settings = null;
    } else {
        clock_settings = new Gio.Settings({schema: "org.gnome.clocks"});
        if (DEBUG){
            show_alarms_in_debuglog(clock_settings);
        }
    }
}

function enable() {
    /*
     * Activación de la extensión. Es donde se crea el botón.
     */
    if (DEBUG) log("Alarm Clock: Activando extensión...");
    acMenu = new AlarmIndicator;
    Main.panel.addToStatusArea('alarm-indicator', acMenu);
    var segundos = 60 * 1000;   // Un minuto.
    timeout = Mainloop.timeout_add(segundos, function () {
        _refresh();
        return true;
    });
}

function disable() {
    /*
     * Extensión desactivada, elimino el objeto y todo caerá detrás.
     */
    Mainloop.source_remove(timeout);
    if ( ! org_gnome_clocks ){
        if (DEBUG) log("Alarm Clock: org.gnome.clocks no instalado.");
    } else {
        clock_settings.disconnect(_alarm_changed_id);
    }
    acMenu.destroy();
    if (DEBUG) log("Alarm Clock: Desactivación completada.");
}
