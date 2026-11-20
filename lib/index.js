var net   = require('net');
var spawn = require('child_process').spawn;

module.exports = function(input, output, settings, cli, buildSettings){
  return new Electrify(input, output, settings, cli, buildSettings);
};

function Electrify(input, output, settings, cli, buildSettings) {
  this.log = require('./log')(this, 'electrify:index');

  this.log.info('initializing');

  if(!input)
    throw new Error('Root param must to be informed!');

  this.env = require('./env')(input, output, settings, cli, buildSettings || {});

  this.scaffold = require('./scaffold')(this);
  this.electron = require('./electron')(this);
  this.app      = require('./app')(this);
  this.plugins  = require('./plugins')(this);

  this.plugins.use(require('./plugins/nodejs'));

  // the socket plugin backs `electrify.methods()`, and is only there for apps
  // that have installed its (optional) `sockjs` dependency
  if(has_module('sockjs'))
    this.plugins.use(require('./plugins/socket'));
  else
    this.log.debug('sockjs not installed, socket plugin disabled');
}

Electrify.prototype.isup = function(){
  return this.plugins.isup();
};

Electrify.prototype.start = function(done){
  this.log.info('start');

  var self = this;

  // `done` gets meteor's url, and an error when meteor didn't answer in time:
  // the url may still come up later, so the app decides whether to load it,
  // retry or show an error
  function started(){
    var nodejs = self.plugins.get('nodejs');
    if(done)
      done(nodejs.config.ROOT_URL, nodejs.ready_error || null);
  }

  if(this.env.app.is_packaged)
    this.plugins.start(started);
  else
    this.app.run(started);
};

Electrify.prototype.stop = function(done){
  this.app.terminate(done);
};

Electrify.prototype.waterfal = function(methods) {
  var self = this, method = methods.shift();
  method[0].apply(method[1], [function(){
    if(methods.length)
      self.waterfal(methods);
  }]);
};

Electrify.prototype.methods = function(methods_table) {
  var socket = this.plugins.get('socket');
  if(!socket) {
    throw new Error(
      'electrify.methods() needs the optional `sockjs` package, install it ' +
      'with `npm install sockjs` inside your .electrify folder'
    );
  }
  socket.methods(methods_table);
};

function has_module(name) {
  try {
    require.resolve(name);
    return true;
  } catch(err) {
    return false;
  }
}

Electrify.prototype._kill = function(process){
  if(this.env.os.is_windows)
    spawn("taskkill", ["/pid", process.pid, '/f', '/t']);
  else
    process.kill();
};

Electrify.prototype.freeport = function(start, done){
  var self = this;
  start = start || 11235;
  var socket = new net.Socket()
    .once('connect', function() {
      socket.destroy();
      self.freeport(++start, done);
    })
    .once('error', function(/* err */) {
      socket.destroy();
      done(start);
    })
    .connect(start, self.env.app.hostname);
};
