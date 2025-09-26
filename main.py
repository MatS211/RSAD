import datetime
import time
import threading
import wmi
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import psutil
from collections import deque

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, async_mode='eventlet')

thread = None

@app.route('/')
def index():
    return render_template('index.html')

def get_cpu_temperature():
    try:
        w = wmi.WMI(namespace="root\\wmi")
        temperature_info = w.MSAcpi_ThermalZoneTemperature()
        if temperature_info:
            # ACPI zwraca 1/10 stopnia Kelvina
            temp_celsius = int(temperature_info[0].CurrentTemperature / 10.0 - 273.15)
            return temp_celsius
    except:
        pass
    return None



def get_sys_materials():
    disk = psutil.disk_usage('/')
    return {
        'cpu_percent': psutil.cpu_percent(None),
        'ram_percent': psutil.virtual_memory().percent,
        'disk_used_percent': disk.percent,
        'process_count': len(psutil.pids()),
        'cpu_temp': get_cpu_temperature(),
    }

update_interval = 1 #ilość sek
history = deque(maxlen=600)

alert_thresholds = {
    "cpu": 80,
    "ram": 80
}

simulating = False
def background_thread():
    global update_interval, simulating
    while True:
        if not simulating:
            data = get_sys_materials()

            data["timestamp"] = datetime.datetime.now().isoformat()
            history.append(data)

            socketio.emit('server_update', data)

            #progi alertów
            if data['cpu_percent'] > alert_thresholds["cpu"]:
                socketio.emit('alert', {
                    'type': 'cpu_percent',
                    'message': f'CPU {data["cpu_percent"]}% (> {alert_thresholds["cpu"]}%)',
                    'value': data['cpu_percent']
                })

            if data['ram_percent'] > alert_thresholds["ram"]:
                socketio.emit('alert', {
                    'type': 'ram_percent',
                    'message': f'RAM {data["ram_percent"]}% (> {alert_thresholds["ram"]}%)',
                    'value': data['ram_percent']
                })
        socketio.sleep(update_interval)

@app.route('/metrics')
def metrics():
    if history:
        return jsonify(list(history))
    else:
        return jsonify([])



clients = {}
client_counter = 0  # licznik klientów

@socketio.on('connect')
def handle_connect():
    global client_counter, thread
    sid = request.sid

    client_counter += 1
    name = f"BrowserClient{client_counter}"
    clients[sid] = {"id": sid, "name": name, "status": "online"}
    emit('connected', {'message': 'connected', 'name': name})
    emit('register_name', {"name": name})

    if thread is None:
        thread = socketio.start_background_task(background_thread)

    socketio.emit('client_update', list(clients.values()))



@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    if sid in clients:
        del clients[sid]
        socketio.emit('client_update', list(clients.values()))

@socketio.on('client_update')
def handle_client_update(data):
    sid = request.sid
    if sid in clients:
        clients[sid].update(data)
    socketio.emit('client_update', list(clients.values()))

@socketio.on('register_client')
def register_client(data):
    sid = request.sid
    name = data.get("name", f"Client-{sid[:5]}")
    if sid in clients:
        clients[sid].update({
            "name": name,
            "cpu": data.get("cpu"),
            "ram": data.get("ram"),
            "status": "online"
        })
        socketio.emit('client_update', list(clients.values()))

@socketio.on('set_interval')
def set_interval(data):
    global update_interval
    interval = data.get("interval", 1)
    try:
        update_interval = max(0, int(interval))
        print(f"[INFO] Interval changed to {update_interval}s")
        socketio.emit('interval_update', {'interval': update_interval})
    except ValueError:
        pass

@socketio.on('set_thresholds')
def set_thresholds(data):
    global alert_thresholds
    cpu_t = data.get("cpu_tres")
    ram_t = data.get("ram_tres")

    if cpu_t is not None:
        alert_thresholds["cpu"] = int(cpu_t)
    if ram_t is not None:
        alert_thresholds["ram"] = int(ram_t)

    print(f"[INFO] Thresholds updated: CPU>{alert_thresholds['cpu']} RAM>{alert_thresholds['ram']}")
    socketio.emit('alert', {
        'type': 'info',
        'message': f'Updated thresholds: CPU>{alert_thresholds["cpu"]}% RAM>{alert_thresholds["ram"]}%'
    })

@socketio.on('simulate_load')
def simulate_load(data):
    global simulating
    load_type = data.get('type')
    duration = data.get('duration', 10)

    def simulate():
        global simulating
        simulating = True
        start = time.time()
        while time.time() - start < duration:
            if load_type == 'cpu':
                cpu_percent = 95
                ram_percent = 40
            elif load_type == 'ram':
                cpu_percent = 30
                ram_percent = 90
            else:
                cpu_percent = 20
                ram_percent = 30

            packet = {
                'cpu_percent': cpu_percent,
                'ram_percent': ram_percent,
                'disk_used_percent': 60,
                'process_count': 123
            }
            socketio.emit('server_update', packet)

            if packet['cpu_percent'] > alert_thresholds["cpu"]:
                socketio.emit('alert', {
                    'type': 'cpu_percent',
                    'message': f'CPU {cpu_percent}% (> {alert_thresholds["cpu"]}%)',
                    'value': packet['cpu_percent']
                })

            if packet['ram_percent'] > alert_thresholds["ram"]:
                socketio.emit('alert', {
                    'type': 'ram_percent',
                    'message': f'RAM {ram_percent}% (> {alert_thresholds["ram"]}%)',
                    'value': packet['ram_percent']
                })
            socketio.sleep(1)
        simulating=False
    # threading.Thread(target=simulate).start()
    socketio.start_background_task(simulate)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)