#!/usr/bin/env node

var path      = require('path');
var join      = path.join;
var fs        = require('fs');
var program   = require('commander');
var spawn     = require('child_process').spawn;
var log       = console.log;
var _         = require('lodash');

program
  .usage('[command] [options]')
  .version(require('../package.json').version)
  .on('--version', function(){
    return require('../package.json').version;
  })
  .on('--help', function(){
    log('  Examples:\n');
    log('    ' + [
      '# cd into meteor dir first',
      'cd /your/meteor/app',
      '',
      'electrify',
      'electrify run',
      'electrify package',
      'electrify package -o /dist/dir',
      'electrify package -o /dist/dir -s file.json',
      'electrify package -i /app/dir -o /dist/dir -s dev.json',
      'electrify package -- <electron-packager-options>',
      '',
      '# more info about electron packager options:',
      '# ~> https://www.npmjs.com/package/electron-packager'
    ].join('\n    ') + '\n');
  });

program
  .option('-i, --input    <path>', 'meteor app dir        | default = .')
  .option('-o, --output   <path>', 'output dir            | default = .electrify/.dist')
  .option('-s, --settings <path>', 'meteor settings file  | default = null (optional)')
  .option('-t, --temp     <path>', 'electrify temp folder | default = system temp folder')
  .option('-a, --arch     <arch>', 'arch to build for     | default = current arch')
  .option('-p, --platform <platform>', 'platform to build for | default = current platform')
;

program
  .command('run')
  .description('(default) start meteor app within electrify context')
  .action(run);

program
  .command('bundle')
  .description('bundle meteor app at `.electrify` dir')
  .action(bundle);

program
  .command('package')
  .description('bundle and package app to `--output` dir')
  .action(package);

program.parse(process.argv);


// default command = run
var cmd = process.argv[2];
if(process.argv.length == 2 || -1 == 'run|bundle|package'.indexOf(cmd) ){
  run();
}

function run_electron(){
  var input         = program.input || process.cwd();
  var electrify_dir = join(input, '.electrify');
  var electron_path = require('electron');
  var settings      = parse_meteor_settings(true);

  if(settings)
    settings = {
      ELECTRIFY_SETTINGS_FILE: path.resolve(settings)
    };
  else
    settings = {};

  log('[[[ electron ' + electrify_dir +'` ]]]');
  spawn(electron_path, [electrify_dir], {
    stdio: 'inherit',
    env: _.extend(settings, process.env)
  });
}

function is_meteor_app(){
  var input = program.input || process.cwd();
  var meteor_dir = join(input, '.meteor');
  return fs.existsSync(meteor_dir);
}

function run(){
  if(has_local_electrify())
    run_electron();
  else if(is_meteor_app())
    electrify().app.init(run_electron);
}

function bundle(){
  electrify().app.bundle(/* server_url */);
}

function package(){
  electrify().app.package(parse_packager_options());
}



function electrify() {
  var input;

  // validates input dir (app-root folder)
  if(program.input && !fs.existsSync(program.input)) {
    console.error('input folder doesn\'t exist\n  ' + program.input);
    process.exit();
  }
  
  input = program.input || process.cwd();

  if(!is_meteor_app()) {
    console.error('not a meteor app\n  ' + input);
    process.exit();
  }

  if(program.output && !fs.existsSync(program.output)) {
    console.error('output folder doesn\'t exist\n  ' + program.output);
    process.exit();
  }

  if(program.temp && !fs.existsSync(program.temp)) {
    console.error('temp folder doesn\'t exist\n  ' + program.temp);
    process.exit();
  }

  var buildSettings = _.pick(program, ['temp', 'arch', 'platform']);

  return require('..')(
    join(input, '.electrify'),
    program.output,
    parse_meteor_settings(),
    true,
    buildSettings
  );
}



function has_local_electrify(){
  // validates input dir (app-root folder)
  if(program.input && !fs.existsSync(program.input)) {
    console.error('input folder doesn\'t exist\n  ' + program.input);
    process.exit();
  }
  
  var input = program.input || process.cwd();

  // validates meteor project
  return fs.existsSync(join(input, '.electrify'));
}



function parse_meteor_settings(return_path_only) {
  if(!program.settings)
    return (return_path_only ? null : {});

  var relative = join(process.cwd(), program.settings);
  var absolute = path.resolve(program.settings);
  var settings = (absolute == program.settings ? absolute : relative);

  if(!fs.existsSync(settings)) {
    log('settings file not found: ', relative);
    process.exit();
  }

  if(return_path_only)
    return settings;
  else
    return require(settings);
}


function parse_packager_options(){
  var names = [
    '--icon',
    '--app-bundle-id',
    '--app-version',
    '--build-version',
    '--cache',
    '--helper-bundle-id',
    '--ignore',
    '--prune',
    '--overwrite',
    '--asar',
    '--asar-unpack',
    '--sign',
    '--version-string'
  ];

  var dashdash = process.argv.indexOf('--');
  var options = {};

  if(~dashdash) {

    var args = process.argv.slice(dashdash+1);

    _.each(args, function(arg){

      var parts = arg.split('=');
      var key = parts[0];
      var val = 'undefined' === typeof(parts[1]) ? true : parts[1];
    
      if(~names.indexOf(key)) {
        if (key === '--app-version') {
            options.appVersion = val;
        } else {
          options[key.slice(2)] = val;
        }
      } else {
        log('Option `' + key + '` doens\'t exist, ignoring it');
      }
    });
  }

  return options;
}
