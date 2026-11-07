import { configuration } from '../runtime/config.mjs';
import { validateRuntimeReports } from './runtime-policy.mjs';
import { publish } from './publish.mjs';
const config=configuration(process.env.RUNTIME_ID || 'python314');
publish({id:config.id,title:(config.variant==='python'?'Python ':'Node.js ')+config.version,alias:config.version+'-preview',workflow:'runtime-publish.yml',metadata:{runtime:config.id},
  validateReports:(records,commit)=>validateRuntimeReports(records,commit,config.id)});
