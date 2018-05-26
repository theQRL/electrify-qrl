require('shelljs/make');

var fs      = require('fs');
var path    = require('path');
var spawn   = require('child_process').spawn;

var _        = require('lodash');
var shell    = require('shelljs');

var git_bin = process.platform == 'win32' ? 'git.exe' : 'git';
var meteor_bin = process.platform == 'win32' ? 'meteor.bat' : 'meteor';
var node_bin = process.platform == 'win32' ? 'node.exe' : 'node';

var NODE_MODS = path.join(__dirname, 'node_modules');
var ISTANBUL  = path.join(NODE_MODS, 'istanbul', 'lib', 'cli.js');
var _MOCHA    = path.join(NODE_MODS, 'mocha', 'bin', '_mocha');
var NPMCHECK  = path.join(NODE_MODS, 'npm-check', 'lib', 'cli.js');
var CODECLIMATE_TEST_REPORTER =
  path.join(NODE_MODS, 'codeclimate-test-reporter', 'bin', 'codeclimate.js');

// setup local env with local symlinks and proper configs
target.setup = function() {
  log('setting up everything for development');

  // list folder paths
  var parent       = path.join(__dirname, '..');
  var leaderboard  = path.join(parent, 'leaderboard');

  // reset folders
  shell.exec('npm link');
  shell.rm('-rf', leaderboard);

  // create sample test app in parent dir
  spawn(git_bin, ['clone', '--depth=1', 'https://github.com/meteor/leaderboard'], {
    stdio: 'inherit',
    cwd: parent
  }).on('exit', function(){

    // removes mobile platforms
    spawn(meteor_bin, ['remove-platform', 'ios', 'android'], {
      stdio: 'inherit',
      cwd: leaderboard
    }).on('exit', function(){
        process.exit();
    });
  });
};

// start test app in dev mode
target.dev = function(action){
  var leaderboard           = path.join(__dirname, '..', 'leaderboard');
  var leaderboard_electrify = path.join(leaderboard, '.electrify');

  log('starting in dev mode');

  if(~'reset'.indexOf(action))
    shell.rm('-rf', leaderboard_electrify);

  spawn('node', [path.join(__dirname, 'bin', 'cli.js')], {
    cwd: leaderboard,
    stdio: 'inherit',
    env: _.extend(_.clone(process.env), {
      DEVELECTRIFY: true,
      LOGELECTRIFY: 'ALL'
    })
  });
};



// tests
target.test = function() {
  spawn(node_bin, [_MOCHA, 'test'], {
    stdio: 'inherit',
    env: _.extend({
      DEVELECTRIFY: true,
      LOGELECTRIFY: 'ALL',
      TESTELECTRIFY: true
    }, process.env)
  });
};

target['test.cover'] = function(done){
  spawn(node_bin, [ISTANBUL, 'cover', _MOCHA], {
    stdio: 'inherit',
    env: _.extend({
      DEVELECTRIFY: true,
      LOGELECTRIFY: 'ALL',
      TESTELECTRIFY: true
    }, process.env)
  }).on('exit', function(code){
    if(done) done(code);
  });
};

target['test.cover.preview'] = function(){
  target['test.cover'](function(){
    if(!fs.existsSync('./coverage/lcov-report')) return;
    spawn('python', ['-m', 'SimpleHTTPServer', '8080'], {
      cwd: './coverage/lcov-report',
      stdio: 'inherit',
      env: _.extend({
        DEVELECTRIFY: true,
        LOGELECTRIFY: 'ALL',
        TESTELECTRIFY: true
      }, process.env)
    });
    console.log('preview coverage at: http://localhost:8080');
  });
};

target['test.cover.send'] = function() {
  var repo_token = process.env.CODECLIMATE_REPO_TOKEN;

  if(repo_token === undefined || repo_token.trim() === '') {
    console.error('No CODECLIMATE_REPO_TOKEN found.');
    process.exit(1);
  }

  target['test.cover'](function(code){
    var lcov_path   = path.join(__dirname, 'coverage', 'lcov.info');
    spawn(node_bin, [CODECLIMATE_TEST_REPORTER], {
      stdio: [
        fs.openSync(lcov_path, 'r'),
        'inherit',
        'inherit'
      ]
    }).on('exit', function() {
      console.log('coverage sent to codeclimate');
      process.exit(code);
    });
  });
};

target['update.version'] = function(version) {
  var filepath, content, replacement;

  // package.json
  replacement  = '"version": "'+ version[0];
  filepath     = path.join(__dirname, 'package.json');
  content      = fs.readFileSync(filepath, 'utf-8');
  content      = content.replace(/"version":\s*"[0-9\.]+/i, replacement);
  fs.writeFileSync(filepath, content);

  // lib/env.js
  replacement  = 'this.version = \''+ version[0];
  filepath     = path.join(__dirname, 'lib', 'env.js');
  content      = fs.readFileSync(filepath, 'utf-8');
  content      = content.replace(/this.version = '[0-9\.]+/i, replacement);
  fs.writeFileSync(filepath, content);

  //HISTORY.md
  filepath     = path.join(__dirname, 'HISTORY.md');
  content      = fs.readFileSync(filepath, 'utf-8');
  fs.writeFileSync(filepath, [
    version[0] + ' / {{DATE..}}',
    '===================',
    '  * {{TOPIC...}}\n',
    content
  ].join('\n'));
};

target['deps.check'] = function(){
  spawn(node_bin, [NPMCHECK], {
    stdio: 'inherit'
  });
};

target['deps.upgrade'] = function(){
  spawn(node_bin, [NPMCHECK, '-u'], {
    stdio: 'inherit'
  });
};

target.publish = function(){
  var version = require('./package.json').version;
  shell.exec('git tag -a '+ version +' -m "Releasing '+ version +'"');
  shell.exec('git push origin master --tags');
  shell.exec('npm publish');
};


function log(){
  var args = Array.prototype.slice.call(arguments);
  console.log.apply(null, ['electrify: '].concat(args));
}