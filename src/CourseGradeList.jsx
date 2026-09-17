import React, { useState } from 'react';
import { gradeBandFromLetterOrPercent, gradeToneClass } from './lib/gradeColors.js';

function decode(str) {
  if (!str || typeof str !== 'string') return str || '';
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function courseGradeValue(course, mode) {
  const letter = String(course?.letterGrade || '').trim();
  const percent = String(course?.percentage || '').trim();
  if (mode === 'percent') return percent || letter || '—';
  return letter || percent || '—';
}

function resolveTeacherPhoto(course) {
  const direct = course?.teacherPhoto || course?.teacherImage || '';
  if (direct && !/\/api\/user\/profilephoto/i.test(direct)) return direct;
  if (course?.teacherUserId) return `/api/blackbaud/profile-photo/${course.teacherUserId}`;
  if (direct) return `/api/blackbaud/photo?url=${encodeURIComponent(direct)}`;
  return null;
}

const GRADE_CHIP_CLASS =
  'inline-flex min-w-[2.75rem] justify-center tabular-nums font-semibold text-[13px] px-2 py-0.5 rounded-md border';

function TeacherAvatar({ name, photoUrl, size = 28 }) {
  const [broken, setBroken] = useState(false);
  const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  const dim = `${size}px`;
  if (photoUrl && !broken) {
    return (
      <img
        src={photoUrl}
        alt=""
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className="rounded-full object-cover shrink-0 bg-zinc-800"
        style={{ width: dim, height: dim }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center rounded-full shrink-0 font-semibold bg-zinc-800 text-zinc-100"
      style={{ width: dim, height: dim, fontSize: Math.max(10, Math.round(size * 0.4)) }}
    >
      {initial}
    </span>
  );
}

export default function CourseGradeList({ groups, mode, onSelectCourse }) {
  if (!groups.length) return null;
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.key} className="overflow-x-auto">
          {groups.length > 1 && (
            <h3 className="font-semibold text-sm mb-2">{group.title}</h3>
          )}
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Class</th>
                <th>Teacher</th>
                <th className="text-right">Grade</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((c, idx) => {
                const value = courseGradeValue(c, mode);
                const band = gradeBandFromLetterOrPercent(c.letterGrade, c.percentage || c.numericGrade);
                const label = decode(c.course) || 'Class';
                const teacherName = decode(c.teacher || 'Teacher TBA');
                const teacherPhoto = resolveTeacherPhoto(c);
                return (
                  <tr
                    key={`${group.key}-${c.sectionId || c.course || idx}`}
                    className={onSelectCourse ? 'cursor-pointer hover:bg-zinc-800/80' : undefined}
                    onClick={() => onSelectCourse?.({ ...c, student: group.key })}
                    onKeyDown={(e) => {
                      if (!onSelectCourse) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectCourse({ ...c, student: group.key });
                      }
                    }}
                    tabIndex={onSelectCourse ? 0 : undefined}
                    aria-label={`Open ${label}`}
                  >
                    <td className="font-medium">{label}</td>
                    <td className="text-base-content/70">
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <TeacherAvatar name={teacherName} photoUrl={teacherPhoto} />
                        <span className="min-w-0">
                          {teacherName}
                          {c.room ? ` · Rm ${c.room}` : ''}
                        </span>
                      </span>
                    </td>
                    <td className="text-right">
                      <span className={`${GRADE_CHIP_CLASS} ${gradeToneClass(band)}`}>
                        {value}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

