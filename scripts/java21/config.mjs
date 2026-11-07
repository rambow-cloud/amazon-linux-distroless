// The directory name is retained for compatibility with the first Java 21 release.
export const supportedMajors = [17, 21, 25];
export function javaMajor(value = process.argv[3] || process.env.JAVA_MAJOR || 21) {
  const major = Number(value);
  if (!supportedMajors.includes(major)) throw new Error('Supported Java majors: 17, 21, 25');
  return major;
}
