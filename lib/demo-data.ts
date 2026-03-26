import { normalizeStudent, type NormalizedStudent } from "./students";

const DEMO_STUDENTS = [
  ["10001", "Adams, Naomi"],
  ["10002", "Ahmed, Samir"],
  ["10003", "Andrews, Chloe"],
  ["10004", "Bennett, Eli"],
  ["10005", "Brown, Maya"],
  ["10006", "Chen, Lucas"],
  ["10007", "Clarke, Ava"],
  ["10008", "Dawson, Noah"],
  ["10009", "Edwards, Zoe"],
  ["10010", "Foster, Liam"],
  ["10011", "Garcia, Sofia"],
  ["10012", "Green, Jonah"],
  ["10013", "Hall, Emma"],
  ["10014", "Iqbal, Amina"],
  ["10015", "Jackson, Leo"],
  ["10016", "Kim, Aria"],
  ["10017", "Lewis, Ethan"],
  ["10018", "Lopez, Isla"],
  ["10019", "Martin, Owen"],
  ["10020", "Nguyen, Mila"],
  ["10021", "Patel, Riya"],
  ["10022", "Reid, Jack"],
  ["10023", "Singh, Nora"],
  ["10024", "Taylor, Caleb"],
  ["10025", "Thomas, Hannah"],
  ["10026", "Walker, Mason"],
  ["10027", "White, Grace"],
  ["10028", "Young, Carter"],
] as const;

export function buildDemoRosterStudents(): NormalizedStudent[] {
  return DEMO_STUDENTS.map(([studentId, rawName]) => normalizeStudent(rawName, studentId));
}
