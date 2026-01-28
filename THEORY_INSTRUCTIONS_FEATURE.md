# Theory Section Instructions Feature

## Overview
Teachers can now write custom instructions specifically for the theory section of their exams. These instructions will be displayed to students at the beginning of Section B (Theory Questions).

## How It Works

### For Teachers (Creating/Editing Exams)

1. **Location**: In the exam creation/editing form, you'll find a new field:
   - **"Theory Section Instructions (Optional)"**
   - Located right below the "General Instructions" field

2. **What to Write**: You can provide specific guidance for theory questions, such as:
   - "Answer in detail with examples"
   - "Minimum 200 words per question"
   - "Use proper essay structure with introduction, body, and conclusion"
   - "Show all working and explain your reasoning"
   - "Answer any 3 out of 5 questions"

3. **Default Behavior**: 
   - If you leave this field empty, students will see: "Provide detailed written answers"
   - If you fill it in, students will see your custom instructions

### For Students (Taking Exams)

When students reach the theory section during an exam, they will see:

```
┌─────────────────────────────────────────────────┐
│ Section B: Theory Questions                     │
│ [Your custom instructions appear here]          │
└─────────────────────────────────────────────────┘
```

**Example with custom instructions:**
```
┌─────────────────────────────────────────────────┐
│ Section B: Theory Questions                     │
│ Answer in detail. Minimum 150 words per         │
│ question. Show all working.                     │
└─────────────────────────────────────────────────┘
```

## Use Cases

### Example 1: Word Count Requirements
```
Theory Section Instructions:
"Each answer should be at least 200 words. Use proper paragraphs and provide specific examples."
```

### Example 2: Partial Questions
```
Theory Section Instructions:
"Answer any 3 questions out of the 5 provided. Each question carries equal marks."
```

### Example 3: Format Requirements
```
Theory Section Instructions:
"Structure your answers with: Introduction, Main Points (with examples), and Conclusion."
```

### Example 4: Subject-Specific
```
Theory Section Instructions:
"Show all mathematical working. Partial credit will be awarded for correct methodology."
```

## Technical Details

### Database Field
- **Field Name**: `theoryInstructions`
- **Type**: Text (optional)
- **Stored In**: Exam record

### Files Modified

1. **`create-exam.html`**
   - Added textarea field for theory instructions
   - Added helper text explaining the feature

2. **`examManager.js`**
   - Added loading of `theoryInstructions` when editing exams
   - Added saving of `theoryInstructions` when creating/updating exams

3. **`takeExam.js`**
   - Modified theory section header to display custom instructions
   - Falls back to default text if no custom instructions provided

## Benefits

✅ **Clear Expectations**: Students know exactly what's expected in theory answers
✅ **Flexible**: Different instructions for different exam types
✅ **Professional**: Makes exams look more polished and organized
✅ **Optional**: Works with or without custom instructions

---

**Status**: ✅ Fully Implemented and Ready to Use
**Date**: 2026-01-28
