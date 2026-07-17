import cbtManifest from '../../modules/cbt/manifest.js';
import attendanceManifest from '../../modules/attendance/manifest.js';
import questionBankManifest from '../../modules/question_bank/manifest.js';
import reportCardsManifest from '../../modules/report_cards/manifest.js';
import homeworkManifest from '../../modules/homework/manifest.js';
import broadsheetManifest from '../../modules/broadsheet/manifest.js';

export function getBuiltinModuleManifests() {
    return [cbtManifest, attendanceManifest, questionBankManifest, reportCardsManifest, homeworkManifest, broadsheetManifest];
}

export default {
    getBuiltinModuleManifests
};
