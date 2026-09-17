import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mail, MapPin } from 'lucide-react';
import { formatAssignmentScore } from './lib/assignmentScore.js';
import { gradeBandFromLetterOrPercent, gradeToneClass } from './lib/gradeColors.js';

function decode(str) {
  if (!str || typeof str !== 'string') return str || '';
  return str
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

function shortCourse(title) {
  const clean = decode(title || '');
  return clean.split(' - ')[0].trim() || clean;
}

export function assignmentsForCourse(assignments, course) {
  if (!course) return [];
  const sid = Number(course.sectionId || course.id);
  const student = course.student;
  const courseName = shortCourse(course.course);
  return (assignments || []).filter((item) => {
    if (student && item.student && item.student !== student) return false;
    if (sid && (Number(item.sectionId) === sid || Number(item.courseId) === sid)) return true;
    const itemName = shortCourse(item.course);
    if (!itemName || !courseName) return false;
    return itemName === courseName
      || String(item.course || '').includes(courseName)
      || courseName.includes(itemName);
  });
}

function statusLabel(item) {
  if (item.status === 'overdue') return 'Overdue';
  if (item.status === 'dueSoon') return 'Due soon';
  if (item.status === 'assigned') return 'Assigned';
  if (item.status === 'done' || item.graded || item.completed) return 'Done';
  return item.type || 'Assignment';
}

function TeacherPhoto({ name, photoUrl, size = 72 }) {
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
      style={{ width: dim, height: dim, fontSize: Math.max(16, Math.round(size * 0.36)) }}
    >
      {initial}
    </span>
  );
}

export default function ClassDetailModal({ course, assignments = [], onClose }) {
  const closeRef = useRef(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const classAssignments = useMemo(
    () => assignmentsForCourse(assignments, course),
    [assignments, course]
  );

  const fallbackTopics = useMemo(() => {
    const types = [];
    const seen = new Set();
    for (const item of classAssignments) {
      const type = decode(item.type || '');
      if (!type || seen.has(type.toLowerCase())) continue;
      seen.add(type.toLowerCase());
      types.push({ id: type, title: type, description: '', publishDate: null });
    }
    return types;
  }, [classAssignments]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!course?.sectionId && !course?.id) return undefined;
    const sectionId = course.sectionId || course.id;
    const params = new URLSearchParams();
    if (course.teacherUserId) params.set('teacherUserId', String(course.teacherUserId));
    if (course.leadSectionId) params.set('leadSectionId', String(course.leadSectionId));
    if (course.associationId) params.set('associationId', String(course.associationId));
    const qs = params.toString();
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    fetch(`/api/blackbaud/class/${encodeURIComponent(sectionId)}${qs ? `?${qs}` : ''}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('class detail failed');
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [course?.sectionId, course?.id, course?.teacherUserId, course?.leadSectionId, course?.associationId]);

  if (!course) return null;

  const title = decode(course.course) || 'Class';
  const teacherName = decode(detail?.teacher?.name || course.teacher || '') || 'Teacher';
  const teacherEmail = detail?.teacher?.email || course.teacherEmail || '';
  const teacherPhoto = detail?.teacher?.photoUrl
    || (course.teacherUserId ? `/api/blackbaud/profile-photo/${course.teacherUserId}` : course.teacherPhoto);
  const room = detail?.room || course.room;
  const bulletin = detail?.bulletin || [];
  const topics = (detail?.topics && detail.topics.length) ? detail.topics : fallbackTopics;
  const topicsFromGradebook = !(detail?.topics && detail.topics.length) && fallbackTopics.length > 0;
  const gradeValue = course.letterGrade || course.percentage || '';

  return (
    <div className="modal modal-open" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-detail-title"
        className="modal-box max-w-4xl p-0 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-800 shrink-0">
          <div className="min-w-0">
            <h2 id="class-detail-title" className="text-[17px] font-semibold text-zinc-100 leading-snug">
              {title}
            </h2>
            <p className="mt-0.5 text-[13px] text-zinc-400">
              {course.student ? `${course.student}` : 'Class'}
              {course.currentTerm ? ` · ${course.currentTerm}` : ''}
              {gradeValue ? ` · ${gradeValue}` : ''}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="btn btn-sm btn-circle btn-ghost"
            aria-label="Close class"
          >
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_14rem]">
            <div className="space-y-6 min-w-0">
              <section>
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-400">
                  Bulletin board
                </h3>
                {loading && bulletin.length === 0 ? (
                  <p className="mt-2 text-[13px] text-zinc-500">Loading bulletin…</p>
                ) : bulletin.length === 0 ? (
                  <p className="mt-2 text-[15px] text-zinc-400 leading-relaxed">
                    {detail?.forbidden?.bulletin || loadError
                      ? 'Bulletin is not available on this parent session. Assignments from the gradebook are listed below.'
                      : 'No bulletin posts for this class.'}
                  </p>
                ) : (
                  <ul className="mt-2 space-y-3">
                    {bulletin.map((post) => (
                      <li key={post.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5">
                        <p className="text-[15px] font-medium text-zinc-100">{decode(post.title)}</p>
                        {post.body ? (
                          <p className="mt-1 text-[15px] text-zinc-300 leading-relaxed whitespace-pre-wrap">
                            {decode(post.body)}
                          </p>
                        ) : null}
                        {(post.author || post.date) && (
                          <p className="mt-2 text-[13px] text-zinc-500">
                            {[post.author, post.date].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-400">
                  Topics
                </h3>
                {loading && topics.length === 0 ? (
                  <p className="mt-2 text-[13px] text-zinc-500">Loading topics…</p>
                ) : topics.length === 0 ? (
                  <p className="mt-2 text-[15px] text-zinc-400 leading-relaxed">
                    {detail?.forbidden?.topics
                      ? 'Topics are not available on this parent session.'
                      : 'No topics posted yet.'}
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {topicsFromGradebook && (
                      <li className="text-[13px] text-zinc-500">From the gradebook</li>
                    )}
                    {topics.map((topic) => (
                      <li key={topic.id} className="rounded-xl border border-zinc-800 px-3.5 py-2.5">
                        <p className="text-[15px] font-medium text-zinc-100">{decode(topic.title)}</p>
                        {topic.description ? (
                          <p className="mt-0.5 text-[13px] text-zinc-400 leading-relaxed">
                            {decode(topic.description)}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-400">
                  Assignments
                </h3>
                {classAssignments.length === 0 ? (
                  <p className="mt-2 text-[15px] text-zinc-400 leading-relaxed">
                    No assignments synced for this class.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-zinc-800 border border-zinc-800 rounded-xl overflow-hidden">
                    {classAssignments.map((item) => {
                      const score = formatAssignmentScore(item.pointsEarned, item.maxPoints);
                      const band = gradeBandFromLetterOrPercent(item.letter, score.percent);
                      return (
                        <li key={item.id} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                          <div className="min-w-0">
                            <p className="text-[15px] text-zinc-100 truncate">{decode(item.title)}</p>
                            <p className="text-[13px] text-zinc-500">
                              {statusLabel(item)}
                              {item.dueDate ? ` · due ${item.dueDate}` : ''}
                            </p>
                          </div>
                          <span className={`shrink-0 text-[13px] tabular-nums font-semibold px-2 py-0.5 rounded-md border ${gradeToneClass(band)}`}>
                            {score.percentLabel || '—'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>

            <aside className="md:border-l md:border-zinc-800 md:pl-5 space-y-3">
              {course.coursePhoto ? (
                <img
                  src={course.coursePhoto}
                  alt=""
                  className="w-full h-24 object-cover rounded-xl border border-zinc-800 bg-zinc-900"
                />
              ) : null}
              <div className="flex md:flex-col items-center md:items-stretch gap-3">
                <TeacherPhoto name={teacherName} photoUrl={teacherPhoto} />
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-zinc-100">{teacherName}</p>
                  {room ? (
                    <p className="mt-1 flex items-center gap-1.5 text-[13px] text-zinc-400">
                      <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      {room}
                    </p>
                  ) : null}
                  {teacherEmail ? (
                    <a
                      href={`mailto:${teacherEmail}`}
                      className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-sky-400 hover:text-sky-300 break-all"
                    >
                      <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      {teacherEmail}
                    </a>
                  ) : (
                    <p className="mt-2 text-[13px] text-zinc-500">No email on file</p>
                  )}
                </div>
              </div>
              {detail?.portalUrl ? (
                <a
                  href={detail.portalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex text-[13px] text-zinc-400 hover:text-zinc-200"
                >
                  Open in Blackbaud
                </a>
              ) : null}
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
