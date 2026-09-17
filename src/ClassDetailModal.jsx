import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mail, MapPin } from 'lucide-react';
import { formatAssignmentScore } from './lib/assignmentScore.js';
import { gradeBandFromLetterOrPercent, gradeToneClass } from './lib/gradeColors.js';
import { isZeroCreditMissing } from './lib/assignmentBuckets.js';

const CLASS_TABS = [
  { id: 'bulletin', label: 'Bulletin' },
  { id: 'topics', label: 'Topics' },
  { id: 'assignments', label: 'Assignments' }
];

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
  if (item.doneOverride || item.acknowledged) return 'Done';
  if (item.status === 'missing' || item.isMissing || isZeroCreditMissing(item)) return 'Missing';
  if (item.status === 'overdue') return 'Overdue';
  if (item.status === 'dueSoon') return 'Due soon';
  if (item.status === 'assigned') return 'Assigned';
  if (item.status === 'done' || item.graded || item.completed) return 'Done';
  return item.type || 'Assignment';
}

function formatPostDate(value) {
  if (!value) return '';
  const raw = String(value);
  const ms = raw.match(/\/Date\((-?\d+)/);
  const d = ms ? new Date(Number(ms[1])) : new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function asPost(item, index, prefix) {
  if (!item || typeof item !== 'object') return null;
  const desc = /^(yes|no)$/i.test(String(item.Description || '').trim()) ? '' : item.Description;
  const title = decode(
    item.title || item.Headline || item.Name || item.Title || item.Subject || item.ShortDescription
    || (desc && String(desc).replace(/<[^>]+>/g, '').trim().length < 90 ? desc : '')
    || item.UrlDisplay || ''
  );
  const body = decode(
    item.body || item.LongText || item.LongDescription || item.BriefDescription
    || item.description || item.Preview || item.Message || (desc && desc !== title ? desc : '') || item.Url || ''
  );
  if (!title && !body) return null;
  return {
    id: String(item.id || item.AlbumID || item.LinkID || item.ItemID || item.ContentItemId || item.DiscussionId || `${prefix}_${index}`),
    title: title || 'Class post',
    body: body && body !== title ? body : (title ? '' : body),
    author: decode(item.author || item.CreateName || item.Author || ''),
    date: formatPostDate(item.date || item.publishDate || item.PublishDate || item.CreateDate || item.InsertDate || ''),
    url: item.url || item.Url || ''
  };
}

function postsFromDetail(detail) {
  const buckets = [];
  const pushBucket = (value) => {
    if (Array.isArray(value)) buckets.push(value);
    else if (value && typeof value === 'object') {
      for (const key of ['bulletin', 'posts', 'discussions', 'Items', 'News', 'items', 'value', 'MessageList', 'Conversation']) {
        if (Array.isArray(value[key])) buckets.push(value[key]);
      }
    }
  };
  pushBucket(detail?.bulletin);
  pushBucket(detail?.posts);
  pushBucket(detail?.discussions);
  pushBucket(detail);
  const posts = [];
  const seen = new Set();
  buckets.forEach((bucket, bucketIndex) => {
    bucket.forEach((item, index) => {
      const post = asPost(item, index, `p${bucketIndex}`);
      if (!post) return;
      const key = post.id || `${post.title}:${post.date}`;
      if (seen.has(key)) return;
      seen.add(key);
      posts.push(post);
    });
  });
  return posts;
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
      style={{ width: dim, height: dim, fontSize: Math.max(16, roundSize(size)) }}
    >
      {initial}
    </span>
  );
}

function roundSize(size) {
  return Math.max(16, Math.round(size * 0.36));
}

function TeacherSidebar({ course, detail, teacherName, teacherEmail, teacherPhoto, room }) {
  return (
    <aside className="shrink-0 md:border-l md:border-zinc-800 md:pl-5 space-y-3">
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
  );
}

export default function ClassDetailModal({ course, assignments = [], onClose }) {
  const closeRef = useRef(null);
  const panelRef = useRef(null);
  const tabRefs = useRef([]);
  const [tab, setTab] = useState('bulletin');
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

  const bulletin = useMemo(() => postsFromDetail(detail), [detail]);
  const topics = (detail?.topics && detail.topics.length) ? detail.topics : fallbackTopics;
  const topicsFromGradebook = !(detail?.topics && detail.topics.length) && fallbackTopics.length > 0;

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
    panelRef.current?.scrollTo({ top: 0 });
  }, [tab]);

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
    setDetail(null);
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
  const courseTeacherPhoto = [course.teacherPhoto, course.teacherImage].find(
    (url) => url && !/\/api\/user\/profilephoto/i.test(url)
  );
  const teacherPhoto = detail?.teacher?.photoUrl
    || courseTeacherPhoto
    || (course.teacherUserId ? `/api/blackbaud/profile-photo/${course.teacherUserId}` : null);
  const room = detail?.room || course.room;
  const gradeValue = course.letterGrade || course.percentage || '';
  const activeTab = CLASS_TABS.find((item) => item.id === tab) || CLASS_TABS[0];

  const onTabKeyDown = (event, index) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = event.key === 'ArrowRight'
      ? (index + 1) % CLASS_TABS.length
      : (index - 1 + CLASS_TABS.length) % CLASS_TABS.length;
    setTab(CLASS_TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="modal modal-open" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-detail-title"
        className="modal-box class-detail-modal max-w-4xl p-0 max-h-[90vh] overflow-hidden flex flex-col"
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

        <div className="flex-1 min-h-0 grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_14rem] md:items-start">
          <div className="min-w-0 min-h-0 flex flex-col gap-3">
            <div
              role="tablist"
              aria-label="Class pages"
              className="join w-full shrink-0"
            >
              {CLASS_TABS.map((item, index) => {
                const selected = tab === item.id;
                return (
                  <button
                    key={item.id}
                    ref={(node) => { tabRefs.current[index] = node; }}
                    type="button"
                    role="tab"
                    id={`class-tab-${item.id}`}
                    aria-selected={selected}
                    aria-controls="class-tab-panel"
                    tabIndex={selected ? 0 : -1}
                    className={`btn join-item flex-1 ${selected ? 'btn-active' : ''}`}
                    onClick={() => setTab(item.id)}
                    onKeyDown={(event) => onTabKeyDown(event, index)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div
              ref={panelRef}
              role="tabpanel"
              id="class-tab-panel"
              aria-labelledby={`class-tab-${activeTab.id}`}
              className="class-detail-panel min-h-0 flex-1 overflow-y-auto max-h-[min(56vh,36rem)] pr-0.5"
            >
              {tab === 'bulletin' && (
                loading && bulletin.length === 0 ? (
                  <p className="text-[13px] text-zinc-500">Loading bulletin…</p>
                ) : bulletin.length === 0 ? (
                  <p className="text-[15px] text-zinc-400 leading-relaxed">
                    {detail?.forbidden?.bulletin || loadError
                      ? 'Bulletin is not available on this parent session.'
                      : 'No bulletin posts for this class.'}
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {bulletin.map((post) => (
                      <li key={post.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5">
                        <p className="text-[15px] font-medium text-zinc-100">{post.title}</p>
                        {(post.author || post.date) && (
                          <p className="mt-1 text-[13px] text-zinc-500">
                            {[post.author, post.date].filter(Boolean).join(' · ')}
                          </p>
                        )}
                        {post.body ? (
                          <p className="mt-2 text-[15px] text-zinc-300 leading-relaxed whitespace-pre-wrap">
                            {post.body}
                          </p>
                        ) : null}
                        {post.url && post.url !== post.body ? (
                          <a
                            href={post.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex text-[13px] text-sky-400 hover:text-sky-300 break-all"
                          >
                            {post.url}
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )
              )}

              {tab === 'topics' && (
                loading && topics.length === 0 ? (
                  <p className="text-[13px] text-zinc-500">Loading topics…</p>
                ) : topics.length === 0 ? (
                  <p className="text-[15px] text-zinc-400 leading-relaxed">
                    {detail?.forbidden?.topics
                      ? 'Topics are not available on this parent session.'
                      : 'No topics posted yet.'}
                  </p>
                ) : (
                  <ul className="space-y-2">
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
                )
              )}

              {tab === 'assignments' && (
                classAssignments.length === 0 ? (
                  <p className="text-[15px] text-zinc-400 leading-relaxed">
                    No assignments synced for this class.
                  </p>
                ) : (
                  <ul className="divide-y divide-zinc-800 border border-zinc-800 rounded-xl overflow-hidden">
                    {classAssignments.map((item) => {
                      const score = formatAssignmentScore(item.pointsEarned, item.maxPoints);
                      const zeroMissing = isZeroCreditMissing(item);
                      const missing = (item.status === 'missing' || item.isMissing || zeroMissing) && !item.doneOverride && !item.acknowledged;
                      const band = missing ? 'missing' : gradeBandFromLetterOrPercent(item.letter, score.percent);
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
                            {missing ? 'Missing' : (score.percentLabel || '—')}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )
              )}
            </div>
          </div>

          <TeacherSidebar
            course={course}
            detail={detail}
            teacherName={teacherName}
            teacherEmail={teacherEmail}
            teacherPhoto={teacherPhoto}
            room={room}
          />
        </div>
      </div>
    </div>
  );
}
