# Theory Questions: 0 Points Configuration

## Overview
Theory questions now default to **0 points** since they require manual grading and shouldn't affect the automatic scoring of objective questions.

## Changes Made

### 1. **Default Points for Theory Questions**
- When creating a new theory question manually: **0 points**
- When changing a question type to "Theory": **Automatically set to 0 points**
- When bulk importing theory questions: **Automatically set to 0 points**

### 2. **Minimum Points Allowed**
- Changed minimum points from `0.5` to `0`
- Teachers can now set any question to 0 points if needed
- Particularly useful for theory questions that will be manually graded

### 3. **Bulk Import Behavior**
- **Objective questions** (with options): Use the "Points per Question" value from the import modal
- **Theory questions** (without options): Automatically set to 0 points
- Updated label to clarify: "Points per Question (Objective Only)"

## Why This Matters

### Before This Change ❌
- Theory questions had points (e.g., 0.5 or 1.0)
- These points were **excluded** from automatic grading
- But they still appeared in the question's point value
- This was confusing because:
  - Total possible points included theory questions
  - But actual scoring didn't count them
  - Students might think theory questions affect their score

### After This Change ✅
- Theory questions have **0 points** by default
- Clear indication that they don't affect automatic scoring
- Teachers can manually grade and adjust scores later
- More transparent for students

## How It Works

### Automatic Scoring Logic
The grading system already skips theory questions:

```javascript
// From takeExam.js
takeExam.exam.questions.forEach(q => {
    const points = parseFloat(q.points) || 0.5;
    
    // Skip theory questions - they require manual grading
    if (q.type === 'theory') {
        return; // Don't add to totalPoints or score
    }
    
    totalPoints += points;
    // ... grading logic for objective questions
});
```

### With 0 Points
- Theory questions still appear in the exam
- Students can still write answers
- Answers are saved in the database
- Teachers can manually review and grade them later
- But they don't affect the automatic score calculation

## Example Scenario

**Exam with Mixed Questions:**
- 10 Objective Questions @ 1 point each = **10 points**
- 3 Theory Questions @ 0 points each = **0 points**
- **Total Auto-Graded Points: 10**

**Student Score:**
- Answers 8/10 objective questions correctly = **8 points**
- Writes answers for all 3 theory questions = **0 points (pending manual grading)**
- **Automatic Score: 80%** (8/10)

**After Manual Grading:**
- Teacher reviews theory answers
- Teacher can manually adjust the total score if needed
- Or implement a separate manual grading system (future feature)

## Files Modified

1. **`create-exam.html`**
   - Changed `min="0.5"` to `min="0"` for points input
   - Updated bulk import label and helper text

2. **`examManager.js`**
   - Set `q.points = 0` when changing to theory type
   - Set `points: 0` for bulk imported theory questions
   - Updated points change handler to allow 0

## Future Enhancements

This sets the foundation for:
- **Manual Grading Interface**: Teachers can review and score theory answers
- **Separate Theory Scoring**: Theory questions can have their own grading system
- **Mixed Scoring**: Combine automatic objective scores with manual theory scores

---

**Status**: ✅ Fully Implemented
**Date**: 2026-01-28
**Impact**: Theory questions no longer interfere with automatic objective question scoring
