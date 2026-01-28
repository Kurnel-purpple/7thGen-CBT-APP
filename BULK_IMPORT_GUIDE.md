# Bulk Import: Objective & Theory Questions Together

## Overview
You can now bulk import **both objective questions (with options) and theory questions (without options)** in a single import operation!

## How It Works

The bulk import system automatically detects:
- **Questions WITH options** → Created as **Objective (MCQ) questions**
- **Questions WITHOUT options** → Created as **Theory questions**

## Supported Formats

### Format 1: Multiline with Options (Objective Questions)
```
1. What is the capital of France?
(a) London
(b) Paris
(c) Berlin
(d) Madrid

2. Which planet is known as the Red Planet?
(a) Venus
(b) Mars
(c) Jupiter
(d) Saturn
```

### Format 2: Questions Without Options (Theory Questions)
```
3. Explain the process of photosynthesis in plants.

4. Discuss the causes and effects of climate change.

5. Describe the water cycle and its importance to life on Earth.
```

### Format 3: Inline Format (Objective Questions)
```
6. What is 2+2? (A) 3 (B) 4 (C) 5 (D) 6
```

### Format 4: Mixed Import (Objective + Theory Together)
```
1. What is the capital of Nigeria?
(a) Lagos
(b) Abuja
(c) Kano
(d) Port Harcourt

2. Which of these is a programming language?
(a) HTML
(b) CSS
(c) Python
(d) JSON

3. Explain the difference between compiled and interpreted programming languages.

4. Discuss the advantages and disadvantages of object-oriented programming.

5. What is the speed of light?
(a) 300,000 km/s
(b) 150,000 km/s
(c) 450,000 km/s
(d) 600,000 km/s
```

## Important Notes

1. **Separation Between Questions**: Use blank lines (double newline) to separate questions
2. **Question Numbering**: Optional - the system will remove leading numbers like "1.", "2)", etc.
3. **Points Assignment**: All imported questions will use the point value specified in the "Points per Question" field (default: 0.5)
4. **Automatic Organization**: After import, the system will automatically:
   - Place all objective questions in **Section A**
   - Place all theory questions in **Section B**

## Example Usage

1. Click **"Bulk Import Questions"** button
2. Set the **"Points per Question"** value (e.g., 0.5 or 1)
3. Paste your questions in any of the supported formats above
4. Click **"Import"**
5. The system will:
   - Import objective questions as MCQ type
   - Import theory questions as Theory type
   - Display them in the correct sections

## What Changed?

**Before**: Only questions with options were imported. Theory questions were ignored.

**Now**: 
- Questions **with options** → Imported as **Objective (MCQ)**
- Questions **without options** → Imported as **Theory**
- You can mix both types in the same import!

---

**Status**: ✅ Implemented and Ready to Use
**Date**: 2026-01-28
