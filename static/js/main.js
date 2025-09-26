var socket = io(); //połączenie z socet.io

function showAlert(text){
    alert_message = alert(text);
}

//Chart.js
var MAX_POINTS = 600;

function makeLineChart(ctx, label){
    return new Chart(ctx,{
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label,
        data: [],
        fill: false,
        tension: 0.1
      }]
    },
    options: {
      animation: false,
      scales: {
        y: { beginAtZero: true, max: 100 }
      }
    }
    });
}

var cpuChart = makeLineChart(document.getElementById('cpuChart').getContext('2d'), 'CPU %');
var ramChart = makeLineChart(document.getElementById('ramChart').getContext('2d'), 'RAM %');
//wykres klientów
var ctxClients = document.getElementById('clientsChart').getContext('2d');
var clientsChart = new Chart(ctxClients, {
  type: 'bar',
  data: {
    labels: [],
    datasets: [
      {
        label: 'CPU %',
        backgroundColor: 'rgba(34, 226, 60, 0.5)',
        yAxisID: 'yCPU',
        data: []
      },
      {
        label: 'RAM MB',
        backgroundColor: 'rgba(37, 181, 238, 0.5)',
        yAxisID: 'yRAM',
        data: []
      }
    ]
  },
  options: {
    responsive: true,
    scales: {
      yCPU: {
        type: 'linear',
        position: 'left',
        min: 0,
        max: 100,
        title: { display: true, text: 'CPU %' }
      },
      yRAM: {
        type: 'linear',
        position: 'right',
        min: 0,
        title: { display: true, text: 'RAM MB' }
      }
    }
  }
});


function pushData(chart, label, value){
    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(value);
    if(chart.data.labels.length > MAX_POINTS){
        chart.data.labels.shift();
        chart.data.datasets[0].data.shift();
    }
    chart.update('none');
}



// wysyłanie danych co 2 sekundy
setInterval(() => {
  const metrics = getClientMetrics();
  socket.emit('client_update', metrics);
}, 2000);



fetch('/metrics')
  .then(res => res.json())
  .then(data =>{
    data.forEach(d =>{
        const ts = new Date(d.timestamp).toLocaleTimeString();
        pushData(cpuChart, ts, d.cpu_percent);
        pushData(ramChart, ts, d.ram_percent);
    });
    console.log("History loaded: ", data.length, "points");
  })


//events
socket.on('connected', (d) => console.log('connected:', d));



document.getElementById('setThresholdsBtn').addEventListener('click', () => {
  var cpu_tres = document.getElementById('cpuThreshold').value;
  var ram_tres = document.getElementById('ramThreshold').value;

  socket.emit('set_thresholds', { cpu_tres, ram_tres});
});

socket.on('server_update', (data) => {
    var ts = new Date().toLocaleTimeString();
    pushData(cpuChart, ts, data.cpu_percent);
    pushData(ramChart, ts, data.ram_percent);

    document.getElementById('cpuValue').innerText = data.cpu_percent.toFixed(1);
    document.getElementById('ramValue').innerText = data.ram_percent.toFixed(1);
    document.getElementById('diskUsedPercent').innerText = data.disk_used_percent.toFixed(1);
    document.getElementById('procCount').innerText = data.process_count;
    document.getElementById('cpuTemp').innerText = data.cpu_temp;

    if (!data.cpu_temp){
      document.getElementById('cpuTemp').innerText = "BRAK CZUJNIKA";
    } 

    var ram = document.getElementById('ram_text');
    var cpu = document.getElementById('cpu_text');
    if(data.cpu_percent <=50){
        cpu.style.color = 'green';
    }else if(data.cpu_percent <= 80) {
        cpu.style.color = 'yellow';
    } else {
        cpu.style.color = 'red';
    }

    if(data.ram_percent <=50){
        ram.style.color = 'green';
    }else if(data.ram_percent <=80) {
        ram.style.color = 'yellow';
    } else {
        ram.style.color = 'red';
    }
});

socket.on('alert', (alert)=>{
    showAlert(`${alert.type.toUpperCase()} ALERT: ${alert.message}`);
});

$(document).ready(function() {
  var table = $('#myTable').DataTable({
    info: false,
    searching: false,
    lengthChange: false,
    ordering: true,
    columnDefs: [
      { targets: [3, 4], type: 'num' }
    ]
  });


  window.clientsTable = table;
});


socket.on('client_update', (clients) => {
  const table = window.clientsTable;
  if (!table) {
    console.error('DataTable nie jest jeszcze zainicjalizowana');
    return;
  }

  const rows = clients.map(c => [
    c.id,
    c.name,
    c.status,
    Number(c.cpu), 
    Number(c.ram)
  ]);

  table.clear();
  table.rows.add(rows);
  table.draw(false);

  clientsChart.data.labels = clients.map(c => c.name);
  clientsChart.data.datasets[0].data = clients.map(c => Number(c.cpu));
  clientsChart.data.datasets[1].data = clients.map(c => Number(c.ram));
  clientsChart.update();
});

var clientName = null;

socket.on('register_name', (data) => {
  clientName = data.name;
  console.log("Assigned name:", clientName);
  document.getElementById('clientName').innerText = clientName;

});


function getClientMetrics() {
  var cpuCores = navigator.hardwareConcurrency || 1;
  var ramGB = navigator.deviceMemory || 1;

  var start = performance.now();
  for (var i = 0; i < 1e7; i++) {}
  var duration = performance.now() - start;

  var cpuLoad = Math.min(100, Math.round(duration / 50 * 100));
  var ramMB = ramGB * 1024;

  return {
    name: clientName || "Uknown",
    cpu: cpuLoad,
    ram: ramMB
  };
}

document.getElementById('intervalSelect').addEventListener('change', (e) => {
  const interval = e.target.value;
  socket.emit('set_interval', { interval: interval });
});

socket.on('interval_update', (data) => {
  document.getElementById('currentInterval').innerHTML = data.interval;
  document.getElementById('intervalSelect').value = data.interval;
});

var cpuInterval = null;
var ramData = [];

// CPU load
document.getElementById('cpuLoad').addEventListener('click', () => {
  console.log("Symulacja CPU load (10s)");
  socket.emit('simulate_load', { type: 'cpu', duration: 10 });
});

// RAM load
document.getElementById('ramLoad').addEventListener('click', () => {
  console.log("Symulacja RAM load (10s)");
  socket.emit('simulate_load', { type: 'ram', duration: 10 });
});
