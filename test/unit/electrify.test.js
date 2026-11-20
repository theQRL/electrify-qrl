var test   = require('node:test');
var assert = require('node:assert');
var fs     = require('fs');
var http   = require('http');
var path   = require('path');

var helpers   = require('./helpers');
var Electrify = require('../../lib');

function electrify(t, pkg, build_settings) {
  return Electrify(helpers.electrify_dir(t, pkg), null, {}, true, build_settings);
}

test('electron version: the installed one wins over the declared one', function(t) {
  var $ = electrify(t, {name: 'my-app', dependencies: {electron: '^40.0.0'}});
  helpers.write_json(
    path.join($.env.app.root, 'node_modules', 'electron', 'package.json'),
    {name: 'electron', version: '40.4.1'}
  );
  assert.strictEqual($.electron.version(), '40.4.1');
});

test('electron version: falls back to an exactly declared one', function(t) {
  ['40.4.1', '=40.4.1', 'v40.4.1'].forEach(function(spec) {
    var $ = electrify(t, {name: 'my-app', dependencies: {electron: spec}});
    assert.strictEqual($.electron.version(), '40.4.1');
  });

  var $ = electrify(t, {name: 'my-app', dependencies: {electron: '41.0.0-beta.2'}});
  assert.strictEqual($.electron.version(), '41.0.0-beta.2');
});

test('electron version: a declared range is not a version to package', function(t) {
  ['^40.0.0', '~40.1.0', '>39.0.0', '<41.0.0', '40.x', '39.0.0 || 40.0.0', 'latest'].forEach(function(spec) {
    assert.throws(function(){
      electrify(t, {name: 'my-app', dependencies: {electron: spec}}).electron.version();
    }, /cannot tell which electron version/, spec);
  });
});

test('electron version: fails when the app has no usable electron', function(t) {
  assert.throws(function(){
    electrify(t, {name: 'my-app'}).electron.version();
  }, /cannot tell which electron version/);

});

test('the running app never installs dependencies, the cli steps do', function(t) {
  var $ = electrify(t);
  var steps = [];

  $.app.ensure_deps = function(next){ steps.push('ensure_deps'); next(); };
  ['auto_load', 'acquire', 'start'].forEach(function(name) {
    $.plugins[name] = function(next){ steps.push(name); next(); };
  });
  $.app.start_meteor = function(next){ steps.push('start_meteor'); next(); };
  $.app.require_node = function(next){ steps.push('require_node'); next(); };
  $.app.bundle_meteor = function(next){ steps.push('bundle_meteor'); next(); };
  $.scaffold.prepare = function(){};

  $.app.run();
  assert.deepStrictEqual(steps, ['auto_load', 'acquire', 'start', 'start_meteor']);

  steps = [];
  $.app.init();
  assert.deepStrictEqual(steps, ['ensure_deps', 'acquire']);

  steps = [];
  $.app.bundle();
  assert.deepStrictEqual(steps, ['ensure_deps', 'auto_load', 'acquire', 'require_node', 'bundle_meteor']);
});

test('bundling stops early when the app has no node binary', function(t) {
  var $ = electrify(t);
  var app = require('../../lib/app')($);

  assert.throws(function(){ app.require_node(function(){}); }, /no node binary at/);

  var node_path = $.plugins.get('nodejs').app_node_path;
  fs.mkdirSync(path.dirname(node_path), {recursive: true});
  fs.writeFileSync(node_path, '');

  var called = false;
  app.require_node(function(){ called = true; });
  assert.ok(called);
});

test('socket plugin is off, and methods() says why, without sockjs', function(t) {
  var $ = electrify(t);
  assert.ok($.plugins.get('nodejs'));
  assert.strictEqual($.plugins.get('socket'), undefined);
  assert.throws(function(){ $.methods({}); }, /npm install sockjs/);
});

test('scaffold writes an app that depends on this package and on electron', function(t) {
  var $ = electrify(t, null, {temp: helpers.tmpdir(t)});
  fs.rmSync(path.join($.env.app.root, 'package.json'));

  $.scaffold.prepare();

  var pkg = JSON.parse(fs.readFileSync(path.join($.env.app.root, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.dependencies[$.env.name], $.env.version);
  assert.ok(pkg.dependencies.electron);

  var index = fs.readFileSync(path.join($.env.app.root, 'index.js'), 'utf8');
  assert.ok(index.includes("require('" + $.env.name + "')"));
  assert.ok(fs.statSync($.env.app.bin).isDirectory());
});

test('windows spawns go through a shell, with quoted arguments', function(t) {
  var $ = electrify(t);
  $.env.os.is_windows = true;

  var seen = capture_spawn(function(){
    var app = require('../../lib/app')($);
    app.spawn('meteor.bat', ['build', 'C:\\Users\\John Smith\\tmp', '--directory'], {cwd: '.'});
  });

  assert.strictEqual(seen.command, 'meteor.bat');
  assert.deepStrictEqual(seen.args, ['build', '"C:\\Users\\John Smith\\tmp"', '--directory']);
  assert.strictEqual(seen.options.shell, true);
  assert.strictEqual(seen.options.cwd, '.');
});

test('other platforms spawn directly, arguments untouched', function(t) {
  var $ = electrify(t);
  $.env.os.is_windows = false;

  var seen = capture_spawn(function(){
    var app = require('../../lib/app')($);
    app.spawn('meteor', ['build', '/tmp/with space', '--directory'], {cwd: '.'});
  });

  assert.deepStrictEqual(seen.args, ['build', '/tmp/with space', '--directory']);
  assert.strictEqual(seen.options.shell, undefined);
});

test('meteor_ready waits until the server answers', function(t, done) {
  var $ = electrify(t);
  var server = http.createServer(function(req, res){ res.end('ok'); });
  t.after(function(){ server.close(); });

  // grab a free port, and only start listening on it later on
  var probe = http.createServer().listen(0, '127.0.0.1', function(){
    var port = probe.address().port;
    probe.close(function(){
      var listening = false;
      setTimeout(function(){
        server.listen(port, '127.0.0.1', function(){ listening = true; });
      }, 300);

      var nodejs = $.plugins.get('nodejs');
      nodejs.meteor_ready('http://127.0.0.1:' + port, function(err){
        assert.ok(listening);
        assert.ifError(err);
        assert.strictEqual(nodejs.ready_error, null);
        done();
      });
    });
  });
});

test('meteor_ready reports an error after its time limit', function(t, done) {
  var $ = electrify(t);
  var probe = http.createServer().listen(0, '127.0.0.1', function(){
    var port = probe.address().port;
    probe.close(function(){
      var started = Date.now();
      // nothing ever listens on that port
      var nodejs = $.plugins.get('nodejs');
      var calls = 0;
      nodejs.meteor_ready('http://127.0.0.1:' + port, function(err){
        calls++;
        assert.ok(Date.now() - started >= 240);
        assert.match(err.message, /did not answer/);
        assert.strictEqual(nodejs.ready_error, err);
        // no retry may fire the callback again
        setTimeout(function(){ assert.strictEqual(calls, 1); done(); }, 300);
      }, 250);
    });
  });
});

test('meteor_ready enforces its limit while a probe is still pending', function(t, done) {
  var $ = electrify(t);
  // accepts connections, never answers
  var sockets = [];
  var server = http.createServer(function(){});
  server.on('connection', function(socket){ sockets.push(socket); });
  t.after(function(){
    sockets.forEach(function(socket){ socket.destroy(); });
    server.close();
  });

  server.listen(0, '127.0.0.1', function(){
    var started = Date.now();
    $.plugins.get('nodejs').meteor_ready('http://127.0.0.1:' + server.address().port, function(err){
      var took = Date.now() - started;
      assert.ok(err);
      // well short of the 1500ms a single probe is allowed
      assert.ok(took >= 240 && took < 1000, 'took ' + took + 'ms');
      done();
    }, 250);
  });
});

test('start() hands the readiness error to its callback', function(t, done) {
  var $ = electrify(t);
  var nodejs = $.plugins.get('nodejs');

  $.env.app.is_packaged = true;
  $.plugins.start = function(started) {
    nodejs.ready_error = new Error('late');
    started();
  };

  $.start(function(url, err) {
    assert.strictEqual(url, nodejs.config.ROOT_URL);
    assert.strictEqual(err.message, 'late');
    done();
  });
});

// runs `fn` with child_process.spawn stubbed out, returns what it was given
// (lib/app.js grabs spawn when it loads, so it has to be loaded inside `fn`)
function capture_spawn(fn) {
  var seen = {};
  var app_path = require.resolve('../../lib/app');
  var child_process = require('child_process');
  var real = child_process.spawn;

  delete require.cache[app_path];
  child_process.spawn = function(command, args, options) {
    seen = {command: command, args: args, options: options};
  };
  try {
    fn();
  } finally {
    child_process.spawn = real;
    delete require.cache[app_path];
  }
  return seen;
}
