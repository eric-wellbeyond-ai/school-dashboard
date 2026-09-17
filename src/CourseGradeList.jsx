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

function TeacherAvatar({ name, photoUrl, size = 20 }) {
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

function studentTone(key) {
  if (key === 'Jade') return 'is-jade';
  if (key === 'Ben') return 'is-ben';
  return '';
}

export default function CourseGradeList({ groups, mode, onSelectCourse }) {
  if (!groups.length) return null;
  return (
    <div className="ff-grades">
      {groups.map((group) => (
        <div key={group.key} className="ff-grades-group">
          <h3 className={`ff-grades-heading ${studentTone(group.key)}`}>
            <span className="ff-student-pill" aria-hidden="true">
              {String(group.key || '?').charAt(0)}
            </span>
            {group.title}
          </h3>
          <ul className="ff-grades-list">
            {group.rows.map((c, idx) => {
              const value = courseGradeValue(c, mode);
              const band = gradeBandFromLetterOrPercent(c.letterGrade, c.percentage || c.numericGrade);
              const label = decode(c.course) || 'Class';
              const teacherName = decode(c.teacher || 'Teacher TBA');
              const teacherPhoto = resolveTeacherPhoto(c);
              const room = c.room ? ` · Rm ${c.room}` : '';
              return (
                <li key={`${group.key}-${c.sectionId || c.course || idx}`}>
                  <button
                    type="button"
                    className="ff-grade-row"
                    onClick={() => onSelectCourse?.({ ...c, student: group.key })}
                    aria-label={`Open ${label}`}
                    title={`${teacherName}${room}`}
                  >
                    <span className="ff-grade-course">
                      <TeacherAvatar name={teacherName} photoUrl={teacherPhoto} />
                      <span className="min-w-0 truncate">{label}</span>
                    </span>
                    <span className={`${GRADE_CHIP_CLASS} ${gradeToneClass(band)}`}>
                      {value}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
