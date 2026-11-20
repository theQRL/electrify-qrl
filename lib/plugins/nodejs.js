var fs     = require('fs-extra');
var spawn  = require('child_process').spawn;
var path   = require('path');
var join   = path.join;
var http   = require('http');
var _      = require('lodash');

module.exports = function($, logger) {
  return new NodeJS($, logger);
};

function NodeJS($, logger){
  this.$ = $;
  this.log = require('../log')($, 'electrify:plugins:nodejs');
  this.name = 'nodejs';

  // when packaged with asar, node and the meteor bundle can only run from the
  // unpacked copy of the app
  this.runtime_root = this.$.env.app.root;
  if(/\.asar$/.test(this.runtime_root) && fs.existsSync(this.runtime_root + '.unpacked'))
    this.runtime_root += '.unpacked';

  this.app_node_path = join(this.runtime_root, 'bin', 'node');

  if(this.$.env.os.is_windows)
    this.app_node_path += '.exe';

  this.config = {
    ROOT_URL: 'http://' + this.$.env.app.hostname + ':3000' // find meteor's port in run time?
  };

  this.log = logger(this.$, 'electrify:plugins:' + this.name);
}

NodeJS.prototype.acquire = function(done){
  
  if(!fs.existsSync(this.app_node_path)){
    var meteor_node = this.$.env.meteor.node;
    if(fs.existsSync(meteor_node)) {
      this.log.info('acquiring nodejs');
      fs.copySync(meteor_node, join(this.$.env.app.bin, path.basename(meteor_node)));
    } else {
      this.log.warn(
        'no nodejs to acquire at ' + meteor_node + ' -- a packaged app ' +
        'needs a node binary at ' + this.app_node_path
      );
    }
  } else
    this.log.info('nodejs already acquired, moving on');

  done();
};

NodeJS.prototype.start = function(done) {
  this.env = {
    ELECTRIFY_VERSION     : this.$.env.version,
    ELECTRIFY_API_VERSION : this.$.env.apiVersion,
    ELECTRON_VERSION      : process.versions.electron,
    CHROME_VERSION        : process.versions.chrome
  };

  // in development mode, when app is not inside elctron, mongodb is just not
  // needed, since meteor itself is already running its own mongodb
  if(!this.$.env.app.is_packaged) {
    this.log.info('app not packaged, skipping start');
    return setTimeout(done, 1);
  }

  this.log.info('starting meteor...');

  this.meteor_main = join(this.runtime_root, 'app', 'main.js');

  var self = this;

  this.$.freeport(null, function(meteor_port){
    self.meteor_port = meteor_port;

    // mimics the process' env data and sets meteor vars on it
    self.config = _.extend({
      PORT               : self.meteor_port,
      ROOT_URL           : 'http://' + self.$.env.app.hostname + ':' + self.meteor_port,
      METEOR_SETTINGS    : JSON.stringify(self.$.env.app.settings)
    }, process.env);

    _.extend(self.config, self.$.plugins.env());

    self.process = spawn(self.app_node_path, [self.meteor_main], {
      env: self.config
      // , stdio: 'inherit'
      // when setting stdio to 'inherit', the node/meteor process CANNOT be
      // spawned and also, no error is shown. it was discovered with try'n'error
      // so now we just listen for stdout and stderr instead, and things appear
      // to be working again
    });

    // mimics inherit without prefixing
    self.process.stdout.pipe(process.stdout);
    self.process.stderr.pipe(process.stderr);

    self.log.debug('waiting for meteor ready');

    self.meteor_ready(self.config.ROOT_URL, done);
  });
};

// polls meteor until it answers. after `max_wait` it stops polling and calls
// back with an error instead, so a slow or stuck server can never leave the
// app hanging on its splash -- the error is also kept as `this.ready_error`
NodeJS.prototype.meteor_ready = function(url, done, max_wait) {
  var self = this;
  var finished = false;
  var req, retry;

  self.ready_error = null;

  function finish(err) {
    if(finished) return;
    finished = true;

    clearTimeout(deadline);
    clearTimeout(retry);
    if(req) req.destroy();

    self.ready_error = err || null;
    done(err);
  }

  // enforced even while a probe is still pending
  var deadline = setTimeout(function() {
    self.log.warn('meteor readiness probe timed out for ' + url);
    finish(new Error('meteor did not answer at ' + url + ' in time'));
  }, max_wait || 60000);

  function attempt() {
    if(finished) return;

    req = http.get(url, function(res) {
      res.resume();
      finish();
    });

    // a connection that is accepted but never answered counts as a failure
    req.setTimeout(1500, function() {
      req.destroy(new Error('meteor readiness timeout'));
    });

    req.on('error', function(/* err */) {
      if(finished) return;
      retry = setTimeout(attempt, 100);
    });
  }

  attempt();
};

NodeJS.prototype.stop = function() {
  if(this.process)
    this.$._kill(this.process);
};