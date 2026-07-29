/// <reference path="../pb_data/types.d.ts" />
// Containment for the "applicant" role (admission candidates).
//
// A candidate holds a real auth token for the duration of their entrance exam.
// Without this migration that token would let them read:
//   - EVERY active exam in the database (exams.listRule only checked that the
//     caller was authenticated — there is no tenancy check on it at all), and
//   - the entire student roster (profiles.listRule was just `id != ""`).
//
// After this migration an applicant can read neither. They receive their own
// exam payload through the privileged /api/cbt/admission/exam endpoint, which
// serves only the exam attached to their own session.
//
// NOTE: the pre-existing cross-school leak on `exams` for teachers/students
// (any authenticated user of ANY school can list any other school's active
// exams) is untouched here — out of scope for the admissions work, but worth
// fixing separately.
//
// `results` is deliberately left alone: an applicant must keep read access to
// their own results row, because startExamSession() looks it up to detect a
// resumable attempt. The candidate's score is suppressed in the UI, not by the
// API rule — a technically-minded candidate could still read their own score
// via the API. Acceptable for prospective students; harden later if needed.
//
// Idempotent: re-running re-applies the same rule strings.

const EXAMS_ID = "z3galr6ey3e0y5w";
const PROFILES_ID = "zcs0vt9obnt3yzy";

const EXAMS_OLD_RULE =
  '@request.auth.id != "" && (status = "active" || created_by = @request.auth.id)';
const EXAMS_NEW_RULE =
  '@request.auth.id != "" && @request.auth.role != "applicant" && ' +
  '(status = "active" || created_by = @request.auth.id)';

const PROFILES_OLD_RULE = '@request.auth.id != ""';
const PROFILES_NEW_RULE =
  '@request.auth.id != "" && @request.auth.role != "applicant"';

migrate((db) => {
  const dao = new Dao(db);

  const exams = dao.findCollectionByNameOrId(EXAMS_ID);
  exams.listRule = EXAMS_NEW_RULE;
  exams.viewRule = EXAMS_NEW_RULE;
  dao.saveCollection(exams);

  const profiles = dao.findCollectionByNameOrId(PROFILES_ID);
  profiles.listRule = PROFILES_NEW_RULE;
  profiles.viewRule = PROFILES_NEW_RULE;
  // Candidates have no profiles row and must never create one — the client
  // guards this too (dataService._syncProfileInBackground), belt and braces.
  profiles.createRule = PROFILES_NEW_RULE;
  return dao.saveCollection(profiles);
}, (db) => {
  const dao = new Dao(db);

  const exams = dao.findCollectionByNameOrId(EXAMS_ID);
  exams.listRule = EXAMS_OLD_RULE;
  exams.viewRule = EXAMS_OLD_RULE;
  dao.saveCollection(exams);

  const profiles = dao.findCollectionByNameOrId(PROFILES_ID);
  profiles.listRule = PROFILES_OLD_RULE;
  profiles.viewRule = PROFILES_OLD_RULE;
  profiles.createRule = PROFILES_OLD_RULE;
  return dao.saveCollection(profiles);
});
