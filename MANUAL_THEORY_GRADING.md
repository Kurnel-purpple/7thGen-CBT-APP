# Manual Theory Grading Feature

## Overview
Teachers can now manually grade theory questions directly from the student's result page. This feature allows teachers to assign points to each theory question answer and automatically recalculate the student's total score.

## How It Works

### For Teachers

#### 1. **Viewing Student Results**
When a teacher opens a student's exam result that contains theory questions, they will see:

- **Student's written answer** displayed in a text box
- **Grading input field** with:
  - Current score (defaults to 0)
  - Maximum points possible for that question
  - Number input to enter the grade
- **Save Theory Grades button** at the bottom of the page

#### 2. **Grading Process**
```
Step 1: Review the student's answer
Step 2: Enter points in the grading input (0 to max points)
Step 3: Repeat for all theory questions
Step 4: Click "Save Theory Grades" button
Step 5: System recalculates total score and updates pass/fail status
```

#### 3. **What Happens When You Save**
- Theory scores are saved to the database
- Total score is recalculated:
  - **Objective points** (auto-graded) + **Theory points** (manual) = **Total**
- Percentage is updated
- Pass/Fail status is updated based on new percentage
- Page reloads to show updated scores

### For Students

When students view their results:

- **Before grading**: Shows "⏳ Awaiting teacher grading" with 0 points
- **After grading**: Shows the points awarded (e.g., "Score: 3.5 / 5 points")
- Their total score reflects both objective and theory question points

## Example Scenario

### Exam Structure
```
Objective Questions:
├─ Q1 (MCQ) ........... 1 point
├─ Q2 (True/False) .... 1 point
├─ Q3 (Fill Blank) .... 0.5 points
└─ Q4 (MCQ) ........... 1 point
   Subtotal: 3.5 points

Theory Questions:
├─ Q5 (Theory) ........ 0 points (max: 5)
└─ Q6 (Theory) ........ 0 points (max: 5)
   Subtotal: 0 points (max: 10)

Total Possible: 13.5 points
```

### Student Takes Exam
- Answers 3/4 objective questions correctly = **2.5 points**
- Writes answers for both theory questions = **0 points** (pending grading)
- **Initial Score: 2.5/3.5 = 71%** (only objective questions counted)

### Teacher Grades Theory Questions
- Q5: Awards **4/5 points** (good answer)
- Q6: Awards **3.5/5 points** (decent answer)
- Clicks "Save Theory Grades"

### Updated Score
- Objective: **2.5 points**
- Theory: **7.5 points** (4 + 3.5)
- **Final Score: 10/13.5 = 74%**
- Status: **PASSED** (if pass score is 50%)

## Technical Implementation

### Database Changes
Added `theoryScores` field to results table:
```javascript
{
  id: "result123",
  studentId: "student456",
  examId: "exam789",
  score: 74,  // Updated percentage
  totalPoints: 13.5,  // Updated total
  passed: true,  // Updated status
  theoryScores: {  // NEW FIELD
    "question5_id": 4,
    "question6_id": 3.5
  },
  answers: { ... },
  // ... other fields
}
```

### Files Modified

#### 1. **`src/js/results.js`**
- Added `theoryScores` state object
- Added `saveTheoryScores()` function
- Updated score calculation to include theory points
- Added grading input fields in theory question rendering
- Added logic to show/hide save button

#### 2. **`src/pages/results.html`**
- Added "Save Theory Grades" button container
- Added CSS for theory badge styling

### Key Functions

#### `saveTheoryScores()`
```javascript
// Recalculates total score including theory points
// Updates database with new scores
// Reloads page to show updated results
```

#### Score Calculation Logic
```javascript
exam.questions.forEach(q => {
  if (q.type === 'theory') {
    // Use manual scores
    theoryPoints += resultsController.theoryScores[q.id] || 0;
  } else {
    // Use auto-grading
    if (answer is correct) {
      objectivePoints += q.points;
    }
  }
});

totalScore = objectivePoints + theoryPoints;
percentage = (totalScore / totalPossible) * 100;
```

## UI Components

### Teacher View - Grading Input
```html
┌─────────────────────────────────────────────────┐
│ Q5. Explain photosynthesis.        (THEORY)     │
│                                [Manual Grading]  │
├─────────────────────────────────────────────────┤
│ Student's Answer:                               │
│ Photosynthesis is the process...               │
│                                                  │
│ ┌─────────────────────────────────────────┐    │
│ │ 📊 Grade this answer:                    │    │
│ │ [4.0] / 5 points                         │    │
│ │ 💡 Enter points earned. Click Save below │    │
│ └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘

        [💾 Save Theory Grades]
```

### Student View - Before Grading
```html
┌─────────────────────────────────────────────────┐
│ Q5. Explain photosynthesis.        (THEORY)     │
│                                [Manual Grading]  │
├─────────────────────────────────────────────────┤
│ Student's Answer:                               │
│ Photosynthesis is the process...               │
│                                                  │
│ Score: 0 / 5 points                             │
│ ⏳ Awaiting teacher grading                     │
└─────────────────────────────────────────────────┘
```

### Student View - After Grading
```html
┌─────────────────────────────────────────────────┐
│ Q5. Explain photosynthesis.        (THEORY)     │
│                                [Manual Grading]  │
├─────────────────────────────────────────────────┤
│ Student's Answer:                               │
│ Photosynthesis is the process...               │
│                                                  │
│ Score: 4 / 5 points                             │
└─────────────────────────────────────────────────┘
```

## Features

✅ **Flexible Grading** - Award any points from 0 to max (including decimals like 3.5)
✅ **Real-time Updates** - Scores recalculate immediately after saving
✅ **Automatic Pass/Fail** - Status updates based on new total score
✅ **Teacher-Only** - Grading inputs only visible to teachers
✅ **Student Visibility** - Students can see their theory scores after grading
✅ **Persistent** - Scores are saved to database and persist across sessions
✅ **Intuitive UI** - Clear visual distinction between graded and ungraded questions

## Validation

- **Minimum**: 0 points
- **Maximum**: Question's max points value
- **Step**: 0.5 (allows half points)
- **Type**: Number input with validation

## Future Enhancements

Potential improvements:
- **Feedback comments** - Allow teachers to add written feedback
- **Rubric support** - Pre-defined grading criteria
- **Bulk grading** - Grade same question across all students
- **Grade history** - Track when/who graded each question
- **Partial auto-grading** - Keyword detection for theory answers

---

**Status**: ✅ Fully Implemented and Ready to Use
**Date**: 2026-01-28
**Impact**: Teachers can now fully grade exams with theory questions and students receive complete scores
