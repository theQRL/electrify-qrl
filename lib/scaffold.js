var fs     = require('fs-extra');
var path   = require('path');

module.exports = function($){
  return new Scaffold($);
};

function Scaffold($){
  this.$ = $;
  this.log = require('./log')($, 'electrify:scaffold');
}

Scaffold.prototype.prepare = function() {

  this.log.info('ensuring basic structure');
  
  fs.ensureDirSync(this.$.env.app.bin);
  fs.ensureDirSync(this.$.env.core.tmp);
  fs.ensureDirSync(this.$.env.core.root);

  var index        = path.join(this.$.env.app.root, 'index.js');
  var packageJson  = path.join(this.$.env.app.root, 'package.json');
  var config       = path.join(this.$.env.app.root, 'electrify.json');
  var gitignore    = path.join(this.$.env.app.root, '.gitignore');

  var index_tmpl    = path.join(__dirname, 'templates', 'index.js');

  if(!fs.existsSync(index)) {
    fs.writeFileSync(index, fs.readFileSync(index_tmpl, 'utf8'));
  }

  if (!fs.existsSync(packageJson)) {
    var dependencies = {};
    dependencies[this.$.env.name] = this.$.env.version;
    // the app picks its own electron, this is what gets run and packaged
    dependencies.electron = 'latest';

    fs.writeFileSync(packageJson, JSON.stringify({
      name: 'qrl-wallet',
      main: 'index.js',
      dependencies: dependencies
    }, null, 2));
  }

  if (!fs.existsSync(config)) {
    fs.writeFileSync(config, JSON.stringify({
      "plugins": []
    }, null, 2));
  }

  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, [
        '.DS_Store', '.dist', 'app',
        'bin', 'db', 'node_modules'
      ].join('\n'));
  }
};
