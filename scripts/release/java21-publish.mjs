import { javaMajor } from '../java21/config.mjs';
import { validateReports } from './java21-policy.mjs';
import { publish } from './publish.mjs';
const major=javaMajor(process.env.JAVA_MAJOR || 21);
publish({id:'java'+major,title:'Java '+major,alias:major+'-preview',workflow:'java21-publish.yml',metadata:{javaMajor:major},
  validateReports:(records,commit)=>validateReports(records,commit,major)});
