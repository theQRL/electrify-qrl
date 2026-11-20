var fs   = require('fs');
var os   = require('os');
var path = require('path');

// creates a throw-away dir, removed when the test ends
exports.tmpdir = function(t) {
  var dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'electrify-unit-')));
  t.after(function(){ fs.rmSync(dir, {recursive: true, force: true}); });
  return dir;
};

exports.write_json = function(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(data));
};

// a meteor app dir with an (unpackaged) `.electrify` folder inside
exports.electrify_dir = function(t, pkg) {
  var dir = path.join(exports.tmpdir(t), '.electrify');
  exports.write_json(path.join(dir, 'package.json'), pkg || {name: 'my-app'});
  return dir;
};
