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

test('electron version: falls back to the declared one', function(t) {
  var $ = electrify(t, {name: 'my-app', dependencies: {electron: '^40.0.0'}});
  assert.strictEqual($.electron.version(), '40.0.0');
});

test('electron version: fails when the app has no usable electron', function(t) {
  assert.throws(function(){
    electrify(t, {name: 'my-app'}).electron.version();
  }, /cannot tell which electron version/);

  assert.throws(function(){
    electrify(t, {name: 'my-app', dependencies: {electron: 'latest'}}).electron.version();
  }, /cannot tell which electron version/);
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

      $.plugins.get('nodejs').meteor_ready('http://127.0.0.1:' + port, function(){
        assert.ok(listening);
        done();
      });
    });
  });
});

test('meteor_ready gives up after its time limit', function(t, done) {
  var $ = electrify(t);
  var probe = http.createServer().listen(0, '127.0.0.1', function(){
    var port = probe.address().port;
    probe.close(function(){
      var started = Date.now();
      // nothing ever listens on that port
      $.plugins.get('nodejs').meteor_ready('http://127.0.0.1:' + port, function(){
        assert.ok(Date.now() - started >= 250);
        done();
      }, 250);
    });
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
