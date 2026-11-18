// Program / college helpers for profiles. The program is free text (schools name them differently); these are only suggestions.
export const PROGRAM_SUGGESTIONS = [
  'Bachelor of Secondary Education', 'Bachelor of Elementary Education', 'Bachelor of Early Childhood Education', 'Bachelor of Special Needs Education',
  'Bachelor of Physical Education', 'Bachelor of Technology and Livelihood Education', 'Bachelor of Culture and Arts Education',
  'BS Information Technology', 'BS Computer Science', 'BS Information Systems', 'BS Nursing', 'BS Midwifery', 'BS Pharmacy', 'BS Psychology',
  'BS Biology', 'BS Chemistry', 'BS Mathematics', 'BS Accountancy', 'BS Business Administration', 'BS Entrepreneurship', 'BS Hospitality Management',
  'BS Tourism Management', 'BS Civil Engineering', 'BS Electrical Engineering', 'BS Mechanical Engineering', 'BS Computer Engineering', 'BS Architecture',
  'BS Criminology', 'BS Social Work', 'BS Agriculture', 'BA Communication', 'BA Political Science', 'AB English', 'Juris Doctor', 'Doctor of Medicine',
]
export const normProgram = s => (s || '').replace(/\s+/g, ' ').trim().slice(0, 100)
export const normBio = s => (s || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 200)
export const programKey = s => normProgram(s).toLowerCase()
export const BIO_MAX = 200
export const PROGRAM_REQUIRED = 'Add your program (for example BS Information Technology).'
// A new account is complete when it has a name, a university and a program (the database enforces the same rule).
export const setupError = ({ name, schoolOk, program }) =>
  !(name || '').trim() ? 'Please add your name.' : !schoolOk ? 'Choose your university.' : normProgram(program).length < 2 ? PROGRAM_REQUIRED : ''
