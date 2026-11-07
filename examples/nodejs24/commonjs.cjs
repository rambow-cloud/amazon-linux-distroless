const { add } = require('native-contract');
console.log(JSON.stringify({nativeAnswer:add(19,23),mode:'commonjs'}));
