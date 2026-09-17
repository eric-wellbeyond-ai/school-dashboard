import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Mail, MapPin, Paperclip } from 'lucide-react';
import { formatAssignmentScore } from './lib/assignmentScore.js';
import { gradeBandFromLetterOrPercent, gradeToneClass } from './lib/gradeColors.js';
import { isZeroCreditMissing } from './lib/assignmentBuckets.js';
import { liveImageSrc, SafePostImage } from './PostDetail.jsx';

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
    || item.description || item.Preview || item.Message || (desc && desc !== title ? desc : '') || ''
  );
  const images = Array.isArray(item.images) ? item.images.filter((image) => liveImageSrc(image)) : [];
  const files = Array.isArray(item.files) ? item.files : [];
  const links = Array.isArray(item.links) ? item.links : [];
  const imageUrl = liveImageSrc({ src: item.imageUrl, alt: title }) || images[0]?.src || null;
  if (!title && !body && !images.length && !files.length) return null;
  return {
    id: String(item.id || item.AlbumID || item.LinkID || item.ItemID || item.ContentItemId || item.DiscussionId || `${prefix}_${index}`),
    title: title || 'Class post',
    body: body && body !== title ? body : (title ? '' : body),
    description: body && body !== title ? body : (title ? '' : body),
    html: item.html || '',
    author: decode(item.author || item.CreateName || item.Author || ''),
    date: formatPostDate(item.date || item.publishDate || item.PublishDate || item.CreateDate || item.InsertDate || ''),
    url: item.url || item.Url || '',
    images,
    files,
    links,
    imageUrl,
    viewed: item.viewed !== true ? false : true,
    feed: item.feed || 'bulletin',
    type: item.type || 'Bulletin',
    source: 'Class bulletin',
    snippet: body
  };
}

function sortUnreadFirst(items) {
  return [...(items || [])].sort((a, b) => {
    const au = a?.viewed === false ? 0 : 1;
    const bu = b?.viewed === false ? 0 : 1;
    return au - bu;
  });
}

function MediaImages({ images }) {
  const visible = (images || []).filter((image) => liveImageSrc(image));
  if (!visible.length) return null;
  return (
    <div className="class-detail-media mt-3 space-y-3">
      {visible.map((image, index) => (
        <ClassMediaFigure key={image.src || index} image={image} />
      ))}
    </div>
  );
}

function ClassMediaFigure({ image }) {
  const [hidden, setHidden] = useState(false);
  const src = liveImageSrc(image);
  if (!src || hidden) return null;
  const href = image.href || image.src;
  const picture = (
    <img
      src={src}
      alt={image.caption ? '' : (image.alt || '')}
      className="class-detail-media-img"
      onError={() => setHidden(true)}
    />
  );
  return (
    <figure className="space-y-1.5">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer">
          {picture}
        </a>
      ) : picture}
      {(image.caption || image.note) ? (
        <figcaption className="text-[13px] text-zinc-400 leading-relaxed">
          {[image.caption, image.note && image.note !== image.caption ? image.note : '']
            .filter(Boolean)
            .join(' — ')}
        </figcaption>
      ) : null}
    </figure>
  );
}

function FileList({ files }) {
  if (!files?.length) return null;
  return (
    <ul className="mt-3 space-y-1.5">
      {files.map((file, index) => (
        <li key={file.url || index} className="flex items-start gap-2 text-[13px] text-zinc-300">
          <Paperclip className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-500" aria-hidden="true" />
          <span className="min-w-0">
            <span className="font-medium text-zinc-200">{file.name || 'Attachment'}</span>
            {file.note ? <span className="block text-zinc-500 leading-relaxed">{file.note}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function LinkList({ links, skipUrl }) {
  const items = (links || []).filter((link) => link?.url && link.url !== skipUrl);
  if (!items.length) return null;
  return (
    <ul className="mt-3 space-y-1.5">
      {items.map((link) => (
        <li key={link.url}>
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-start gap-1.5 text-[13px] text-sky-400 hover:text-sky-300 break-all"
          >
            <ExternalLink className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            {link.label || link.url}
          </a>
        </li>
      ))}
    </ul>
  );
}

function RichBody({ text, images, files, links, url }) {
  return (
    <>
      {text ? (
        <p className="mt-2 text-[15px] text-zinc-300 leading-relaxed whitespace-pre-wrap">{text}</p>
      ) : null}
      <MediaImages images={images} />
      <FileList files={files} />
      <LinkList links={links} skipUrl={url} />
    </>
  );
}

const TOPIC_STOP = new Set(['unit', 'week', 'notes', 'resource', 'video', 'with', 'from', 'this', 'that', 'plus']);

export function assignmentsForTopic(assignments, topic) {
  const list = [];
  const seen = new Set();
  const push = (item) => {
    if (!item) return;
    const key = String(item.id || item.title);
    if (seen.has(key)) return;
    seen.add(key);
    list.push(item);
  };
  (topic?.assignments || []).forEach(push);
  const name = decode(topic?.title || '').toLowerCase();
  if (!name) return list;
  const tokens = name.split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !TOPIC_STOP.has(word));
  for (const item of assignments || []) {
    const title = decode(item.title || '').toLowerCase();
    const type = decode(item.type || '').toLowerCase();
    const fullHit = (name.length > 4 && (title.includes(name) || type.includes(name)))
      || (type.length > 4 && name.includes(type));
    const tokenHit = tokens.length > 0 && tokens.every((token) => title.includes(token) || type.includes(token));
    if (fullHit || tokenHit) push(item);
  }
  return list;
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

function AssignmentRow({ item, onOpen }) {
  const score = formatAssignmentScore(item.pointsEarned, item.maxPoints);
  const zeroMissing = isZeroCreditMissing(item);
  const missing = (item.status === 'missing' || item.isMissing || zeroMissing) && !item.doneOverride && !item.acknowledged;
  const band = missing ? 'missing' : gradeBandFromLetterOrPercent(item.letter, score.percent);
  const title = decode(item.title);
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-baseline justify-between gap-3 px-3.5 py-2.5 min-h-11 text-left hover:bg-zinc-900/70"
        onClick={(event) => {
          event.stopPropagation();
          onOpen?.(item);
        }}
        aria-haspopup="dialog"
        aria-label={`Open ${title}`}
      >
        <div className="min-w-0">
          <p className="text-[15px] text-zinc-100 truncate">{title}</p>
          <p className="text-[13px] text-zinc-500">
            {statusLabel(item)}
            {item.dueDate ? ` · due ${item.dueDate}` : ''}
          </p>
        </div>
        <span className={`shrink-0 text-[13px] tabular-nums font-semibold px-2 py-0.5 rounded-md border ${gradeToneClass(band)}`}>
          {missing ? 'Missing' : (score.percentLabel || '—')}
        </span>
      </button>
    </li>
  );
}

function TeacherPhoto({ name, photoUrl, size = 72 }) {
  const [broken, setBroken] = useState(false);
  const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  const dim = `${size}px`;
  const live = liveImageSrc(photoUrl);
  if (live && !broken) {
    return (
      <img
        src={live}
        alt=""
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className="rounded-full object-cover shrink-0"
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
      {liveImageSrc(course.coursePhoto) ? (
        <SafePostImage
          src={course.coursePhoto}
          alt=""
          className="w-full h-24 object-cover rounded-xl border border-zinc-800"
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

export default function ClassDetailModal({
  course,
  assignments = [],
  onClose,
  onOpenTask,
  onOpenPost,
  readOverrides = {},
  taskModalOpen = false
}) {
  const closeRef = useRef(null);
  const panelRef = useRef(null);
  const tabRefs = useRef([]);
  const [tab, setTab] = useState('bulletin');
  const [openTopicId, setOpenTopicId] = useState(null);
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

  const bulletin = useMemo(() => sortUnreadFirst(postsFromDetail(detail).map((item) => {
    const key = `${item.feed || 'bulletin'}:${item.id}`;
    if (!Object.prototype.hasOwnProperty.call(readOverrides, key)) return item;
    return { ...item, viewed: readOverrides[key] };
  })), [detail, readOverrides]);
  const topics = useMemo(() => {
    const list = (detail?.topics && detail.topics.length) ? detail.topics : fallbackTopics;
    return sortUnreadFirst(list.map((item) => {
      const key = `topics:${item.id}`;
      if (!Object.prototype.hasOwnProperty.call(readOverrides, key)) return item;
      return { ...item, viewed: readOverrides[key] };
    }));
  }, [detail, fallbackTopics, readOverrides]);
  const topicsFromGradebook = !(detail?.topics && detail.topics.length) && fallbackTopics.length > 0;
  const openTopic = topics.find((topic) => String(topic.id) === String(openTopicId)) || null;
  const topicAssignments = useMemo(
    () => (openTopic ? assignmentsForTopic(classAssignments, openTopic) : []),
    [classAssignments, openTopic]
  );

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (taskModalOpen) return;
      if (openTopicId) {
        setOpenTopicId(null);
        return;
      }
      onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, openTopicId, taskModalOpen]);

  useEffect(() => {
    setOpenTopicId(null);
    panelRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  useEffect(() => {
    setOpenTopicId(null);
  }, [course?.sectionId, course?.id]);

  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [openTopicId]);

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
                  <ul className="space-y-2">
                    {bulletin.map((post) => {
                      const thumb = liveImageSrc({ src: post.imageUrl, alt: post.title })
                        || liveImageSrc(post.images?.[0]);
                      return (
                      <li key={post.id}>
                        <button
                          type="button"
                          className={`w-full min-h-11 rounded-xl border border-zinc-800 px-3.5 py-2.5 text-left hover:bg-zinc-900/70 flex items-start gap-3 ${post.viewed === false ? 'ff-feed-row is-unread' : ''}`}
                          onClick={() => onOpenPost?.(post)}
                        >
                          <span className="min-w-0 flex-1">
                          <span className="ff-feed-row-title block text-[15px] font-medium text-zinc-100">{post.title}</span>
                          {(post.author || post.date) && (
                            <span className="mt-1 block text-[13px] text-zinc-500">
                              {[post.author, post.date].filter(Boolean).join(' · ')}
                            </span>
                          )}
                          {post.body ? (
                            <span className="mt-0.5 block text-[13px] text-zinc-400 leading-relaxed line-clamp-2">
                              {decode(post.body)}
                            </span>
                          ) : null}
                          </span>
                          {thumb ? <SafePostImage src={thumb} alt="" className="ff-feed-thumb" /> : null}
                        </button>
                      </li>
                      );
                    })}
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
                ) : openTopic ? (
                  <div>
                    <button
                      type="button"
                      onClick={() => setOpenTopicId(null)}
                      aria-label="Back to topics"
                      className="inline-flex items-center gap-1 min-h-11 text-[13px] font-medium text-zinc-300 hover:text-zinc-100"
                    >
                      <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                      Topics
                    </button>
                    <h3 className="mt-3 text-[17px] font-semibold text-zinc-100 leading-snug">
                      {decode(openTopic.title)}
                    </h3>
                    {(openTopic.author || openTopic.publishDate) && (
                      <p className="mt-1 text-[13px] text-zinc-500">
                        {[openTopic.author, openTopic.publishDate].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    <RichBody
                      text={decode(openTopic.description)}
                      images={openTopic.images}
                      files={openTopic.files}
                      links={openTopic.links}
                    />
                    {(openTopic.blocks || []).map((block, index) => (
                      <div key={`${block.title || 'block'}_${index}`} className="mt-4">
                        {block.title ? (
                          <p className="text-[15px] font-medium text-zinc-100">{decode(block.title)}</p>
                        ) : null}
                        {block.body ? (
                          <p className="mt-1 text-[15px] text-zinc-300 leading-relaxed whitespace-pre-wrap">
                            {decode(block.body)}
                          </p>
                        ) : null}
                      </div>
                    ))}
                    <div className="mt-5">
                      <p className="text-[13px] font-medium text-zinc-500">Assignments</p>
                      {topicAssignments.length === 0 ? (
                        <p className="mt-2 text-[15px] text-zinc-400 leading-relaxed">
                          No assignments listed under this topic.
                        </p>
                      ) : (
                        <ul className="mt-2 divide-y divide-zinc-800 border border-zinc-800 rounded-xl overflow-hidden">
                          {topicAssignments.map((item) => (
                            <AssignmentRow key={item.id} item={item} onOpen={onOpenTask} />
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {topicsFromGradebook && (
                      <li className="text-[13px] text-zinc-500">From the gradebook</li>
                    )}
                    {topics.map((topic) => {
                      const preview = decode(topic.description || '');
                      const thumb = liveImageSrc({ src: topic.thumbUrl || topic.imageUrl, alt: topic.title })
                        || liveImageSrc(topic.images?.[0]);
                      return (
                        <li key={topic.id}>
                          <button
                            type="button"
                            onClick={() => onOpenPost?.({
                              ...topic,
                              feed: 'topics',
                              type: 'Topic',
                              source: 'Class topic',
                              date: topic.publishDate || topic.date,
                              description: [
                                decode(topic.description || ''),
                                ...(topic.blocks || []).map((block) => [decode(block.title || ''), decode(block.body || '')].filter(Boolean).join('\n')).filter(Boolean)
                              ].filter(Boolean).join('\n\n'),
                              viewed: topic.viewed === false ? false : topic.viewed
                            })}
                            aria-label={`Open topic ${decode(topic.title)}`}
                            className={`w-full min-h-11 rounded-xl border border-zinc-800 px-3.5 py-2.5 text-left hover:bg-zinc-900/70 flex items-start gap-3 ${topic.viewed === false ? 'ff-feed-row is-unread' : ''}`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className={`block text-[15px] text-zinc-100 ${topic.viewed === false ? 'font-semibold' : 'font-medium'}`}>{decode(topic.title)}</span>
                              {preview ? (
                                <span className="mt-0.5 block text-[13px] text-zinc-400 leading-relaxed line-clamp-2">
                                  {preview}
                                </span>
                              ) : topic.publishDate ? (
                                <span className="mt-0.5 block text-[13px] text-zinc-500">{topic.publishDate}</span>
                              ) : null}
                            </span>
                            {thumb ? <SafePostImage src={thumb} alt="" className="ff-feed-thumb" /> : null}
                            <ChevronRight className="w-4 h-4 shrink-0 text-zinc-500 mt-1" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
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
                    {classAssignments.map((item) => (
                      <AssignmentRow key={item.id} item={item} onOpen={onOpenTask} />
                    ))}
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
