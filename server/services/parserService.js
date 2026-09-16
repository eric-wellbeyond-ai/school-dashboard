/**
 * parserService.js
 * 
 * Extracts student-specific tasks (for "Ben" and "Jade") and events
 * originating from "Westlake Lutheran Academy" or "sportsYou" from email payloads.
 */

// Decode base64 / base64url data from Gmail API payloads
export function decodeBase64(data) {
  if (!data) return '';
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(normalized, 'base64').toString('utf-8');
  } catch (err) {
    console.error('Error decoding base64 data:', err);
    return '';
  }
}

// Extract full plain text or HTML body from a nested Gmail message payload
export function extractBodyFromPayload(payload) {
  if (!payload) return '';
  
  if (payload.body && payload.body.data) {
    return decodeBase64(payload.body.data);
  }

  let text = '';
  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        text += decodeBase64(part.body.data) + '\n';
      } else if (part.mimeType === 'text/html' && part.body && part.body.data && !text) {
        // Fallback to HTML if plain text not found
        text += decodeBase64(part.body.data).replace(/<[^>]+>/g, ' ') + '\n';
      } else if (part.parts) {
        text += extractBodyFromPayload(part) + '\n';
      }
    }
  }

  return text.trim();
}

// Normalize email structure whether coming directly from Gmail API or simplified objects
export function normalizeEmail(email) {
  if (!email) return null;

  // If already normalized
  if (email.subject && email.body && email.from) {
    return {
      id: email.id || `mail_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      from: email.from,
      subject: email.subject,
      snippet: email.snippet || '',
      body: email.body,
      date: email.date || new Date().toISOString()
    };
  }

  // Gmail API message format
  const headers = email.payload?.headers || [];
  const getHeader = (name) => {
    const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
    return header ? header.value : '';
  };

  const from = getHeader('From') || email.from || '';
  const subject = getHeader('Subject') || email.subject || '';
  const date = getHeader('Date') || (email.internalDate 
    ? new Date(parseInt(email.internalDate, 10)).toISOString() 
    : new Date().toISOString());
  const snippet = email.snippet || '';
  const body = extractBodyFromPayload(email.payload) || snippet;

  return {
    id: email.id || `mail_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    from,
    subject,
    snippet,
    body,
    date
  };
}

// Determine if the email originates from Westlake Lutheran Academy or sportsYou
export function identifySource(email) {
  const textToScan = `${email.from} ${email.subject} ${email.snippet}`.toLowerCase();

  const isSportsYou = 
    textToScan.includes('sportsyou') || 
    textToScan.includes('sports you') || 
    textToScan.includes('no-reply@sportsyou.com');

  const isWestlake = 
    textToScan.includes('westlake lutheran') || 
    textToScan.includes('westlake academy') || 
    textToScan.includes('westlake') || 
    textToScan.includes('@westlakelutheran.org') ||
    textToScan.includes('wla ');

  if (isSportsYou) return 'sportsYou';
  if (isWestlake) return 'Westlake Lutheran Academy';
  return null;
}

// Determine student relevance ("Ben", "Jade", or "Both")
export function detectStudent(text) {
  if (!text) return null;
  const hasBen = /\bBen\b/i.test(text) || /\bBenjamin\b/i.test(text);
  const hasJade = /\bJade\b/i.test(text);

  if (hasBen && hasJade) return 'Both';
  if (hasBen) return 'Ben';
  if (hasJade) return 'Jade';
  return null;
}

// Detect subject/course category
export function detectCourse(text) {
  const lower = text.toLowerCase();
  if (lower.includes('math') || lower.includes('algebra') || lower.includes('geometry')) return 'Mathematics';
  if (lower.includes('science') || lower.includes('biology') || lower.includes('chemistry') || lower.includes('photosynthesis')) return 'Science';
  if (lower.includes('english') || lower.includes('literature') || lower.includes('ela') || lower.includes('reading') || lower.includes('spelling')) return 'English / ELA';
  if (lower.includes('history') || lower.includes('social studies') || lower.includes('geography') || lower.includes('texas')) return 'History / Social Studies';
  if (lower.includes('bible') || lower.includes('religion') || lower.includes('theology') || lower.includes('proverbs')) return 'Bible Studies';
  if (lower.includes('soccer') || lower.includes('volleyball') || lower.includes('basketball') || lower.includes('track') || lower.includes('athletics')) return 'Athletics';
  if (lower.includes('music') || lower.includes('band') || lower.includes('choir') || lower.includes('art')) return 'Fine Arts';
  return 'General';
}

// Extract due date string if present
export function extractDueDate(text, defaultDate) {
  const duePattern = /(?:due|by|turn in by|deadline:?)\s+([A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?|tomorrow|next\s+[A-Za-z]+|friday(?:\s+morning)?|monday|tuesday|wednesday|thursday)/i;
  const match = text.match(duePattern);
  if (match && match[1]) {
    return match[1].trim();
  }
  return defaultDate ? new Date(defaultDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Due this week';
}

// Extract tasks for Ben and Jade
export function extractTasksFromEmail(email, source) {
  const tasks = [];
  const lines = (email.body || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Default student from subject/email if specific to one child
  const emailWideStudent = detectStudent(email.subject);

  const taskKeywords = [
    'homework', 'assignment', 'project', 'quiz', 'test', 'exam',
    'due', 'complete', 'read chapter', 'worksheet', 'turn in',
    'bring', 'practice log', 'signed form', 'permission slip', 'study',
    'problem set', 'memorization', 'recitation', 'packet', 'waiver'
  ];

  let currentSectionStudent = emailWideStudent;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for section headers (e.g., "Ben's Middle School Assignments:", "Jade:")
    if (/^ben(?:'s)?\b/i.test(line) && (line.endsWith(':') || line.toLowerCase().includes('assignment') || line.toLowerCase().includes('grade'))) {
      currentSectionStudent = 'Ben';
      continue;
    } else if (/^jade(?:'s)?\b/i.test(line) && (line.endsWith(':') || line.toLowerCase().includes('assignment') || line.toLowerCase().includes('grade'))) {
      currentSectionStudent = 'Jade';
      continue;
    } else if (line.toLowerCase().includes('events') || line.toLowerCase().includes('schedule:')) {
      // Switched into events section
      currentSectionStudent = null;
      continue;
    }

    // Skip general greeting or headers
    if (line.endsWith(':') || line.startsWith('Dear ') || line.startsWith('Here is your') || line.startsWith('New Message from')) {
      continue;
    }

    // Check if line is an actual task or bullet item
    const lowerLine = line.toLowerCase();
    const isBullet = /^[-*•]\s+/.test(line) || /^\d+[\.\)]\s+/.test(line);
    const hasTaskKeyword = taskKeywords.some(keyword => lowerLine.includes(keyword));

    // Must not be an event (game, practice, chapel, etc.)
    const isEvent = /^(?:practice|home game|away game|weekend tournament|all-school chapel|pep rally|clinic practice|friendly scrimmage|event:)/i.test(line.replace(/^[-*•\d\.\)\s]+/, ''));
    if (isEvent) {
      continue;
    }

    if ((isBullet && hasTaskKeyword) || (hasTaskKeyword && (lowerLine.includes('due') || lowerLine.includes('turn in')))) {
      const lineStudent = detectStudent(line) || currentSectionStudent || emailWideStudent;
      if (!lineStudent) continue;

      const cleanTitle = line
        .replace(/^[-*•\d\.\)\s]+/, '')
        .replace(/^(Ben|Jade):\s*/i, '')
        .trim();

      if (cleanTitle.length >= 6) {
        const targetStudents = lineStudent === 'Both' ? ['Ben', 'Jade'] : [lineStudent];

        targetStudents.forEach(st => {
          tasks.push({
            id: `task_${email.id}_${tasks.length + 1}_${st.toLowerCase()}`,
            title: cleanTitle,
            student: st,
            course: detectCourse(line + ' ' + email.subject),
            dueDate: extractDueDate(line, email.date),
            source: source,
            completed: false,
            priority: lowerLine.includes('test') || lowerLine.includes('exam') || lowerLine.includes('project') || lowerLine.includes('waiver') ? 'high' : 'medium',
            emailSubject: email.subject,
            emailDate: email.date
          });
        });
      }
    }
  }

  return tasks;
}

// Extract events and sports schedule items
export function extractEventsFromEmail(email, source) {
  const events = [];
  const lines = (email.body || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const emailWideStudent = detectStudent(email.subject);

  const eventKeywords = [
    'game', 'practice', 'match', 'tournament', 'scrimmage', 'meet',
    'chapel', 'assembly', 'concert', 'field trip', 'parent-teacher',
    'open house', 'spirit day', 'early release', 'pep rally', 'clinic'
  ];

  let currentSectionStudent = emailWideStudent;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check student section headers
    if (/^ben(?:'s)?\b/i.test(line) && (line.endsWith(':') || line.toLowerCase().includes('schedule'))) {
      currentSectionStudent = 'Ben';
      continue;
    } else if (/^jade(?:'s)?\b/i.test(line) && (line.endsWith(':') || line.toLowerCase().includes('schedule'))) {
      currentSectionStudent = 'Jade';
      continue;
    } else if (line.toLowerCase().includes('all-school') || line.toLowerCase().includes('upcoming school events:')) {
      currentSectionStudent = 'All';
      continue;
    }

    if (line.endsWith(':') || line.startsWith('Dear ') || line.startsWith('Here is your') || line.startsWith('New Message from')) {
      continue;
    }

    const lowerLine = line.toLowerCase();
    const isEventMatch = eventKeywords.some(k => lowerLine.includes(k));
    if (!isEventMatch) continue;

    // Must not be an assignment
    if (lowerLine.includes('problem set') || lowerLine.includes('worksheet') || lowerLine.includes('memorization') || lowerLine.includes('permission slip and $15')) {
      continue;
    }

    // Time extraction (e.g. 3:45 PM - 5:15 PM, 8:30 AM, 11:30 AM)
    const timeMatch = line.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)(?:\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))?)/);
    const time = timeMatch ? timeMatch[0] : 'Time TBA';

    // Date extraction (e.g. Wednesday, Sep 17, Tuesday, Sep 16, Sat, Sep 20)
    const dateMatch = line.match(/\b((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i);
    const dateStr = dateMatch ? dateMatch[0] : new Date(email.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    // Location extraction
    let location = 'Westlake Campus';
    if (lowerLine.includes('sanctuary')) {
      location = 'WLA Sanctuary';
    } else if (lowerLine.includes('auxiliary gym')) {
      location = 'WLA Auxiliary Gym';
    } else if (lowerLine.includes('main gym')) {
      location = 'Westlake Main Gym';
    } else if (lowerLine.includes('athletic field') || lowerLine.includes('westlake field')) {
      location = 'Westlake Athletic Field';
    } else if (lowerLine.includes("st. john's") || lowerLine.includes('st. john')) {
      location = "St. John's Athletic Complex";
    } else if (lowerLine.includes('science center')) {
      location = 'Hill Country Science Center';
    } else {
      const locMatch = line.match(/(?:at|in)\s+([A-Z][A-Za-z0-9\s'\.]+?)(?:\s*\(|\s*$|\s*,\s*)/);
      if (locMatch && locMatch[1]) {
        location = locMatch[1].trim();
      }
    }

    const student = detectStudent(line) || currentSectionStudent || emailWideStudent || 'All';

    let type = 'school_event';
    if (source === 'sportsYou' || lowerLine.includes('game') || lowerLine.includes('practice') || lowerLine.includes('match') || lowerLine.includes('tournament') || lowerLine.includes('clinic') || lowerLine.includes('scrimmage')) {
      type = 'sports';
    } else if (lowerLine.includes('chapel') || lowerLine.includes('spirit') || lowerLine.includes('rally')) {
      type = 'school_event';
    } else if (lowerLine.includes('field trip')) {
      type = 'academic';
    }

    // Clean title
    let cleanTitle = line
      .replace(/^[-*•\d\.\)\s]+/, '')
      .replace(/^(Ben|Jade):\s*/i, '')
      .replace(/:\s*$/, '')
      .trim();

    // If title is long and contains the time/location details, extract a clean headline
    if (cleanTitle.includes(':')) {
      const parts = cleanTitle.split(':');
      if (parts[0].length > 5) {
        cleanTitle = parts[0].trim();
      }
    }

    events.push({
      id: `event_${email.id}_${events.length + 1}`,
      title: cleanTitle,
      student: student === 'Both' ? 'All' : student,
      date: dateStr,
      time: time,
      location: location,
      source: source,
      type: type,
      description: line.replace(/^[-*•\d\.\)\s]+/, '').trim()
    });
  }

  return events;
}

/**
 * Main parser module function
 * Accepts an array of email payloads (or single email) and extracts
 * student-specific tasks (Ben, Jade) and events from Westlake Lutheran Academy or sportsYou.
 */
export function parseEmailPayloads(payloads) {
  if (!payloads) {
    return { tasks: [], events: [], stats: { totalProcessed: 0, matchedEmails: 0 } };
  }

  const rawList = Array.isArray(payloads) ? payloads : [payloads];
  const allTasks = [];
  const allEvents = [];
  let matchedCount = 0;

  for (const item of rawList) {
    const email = normalizeEmail(item);
    if (!email) continue;

    const source = identifySource(email);
    // Only process emails originating from Westlake Lutheran Academy or sportsYou
    if (!source) continue;

    matchedCount++;

    const tasks = extractTasksFromEmail(email, source);
    const events = extractEventsFromEmail(email, source);

    allTasks.push(...tasks);
    allEvents.push(...events);
  }

  // Deduplicate tasks by title and student
  const uniqueTasks = [];
  const seenTasks = new Set();
  for (const task of allTasks) {
    const key = `${task.student}_${task.title.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    if (!seenTasks.has(key)) {
      seenTasks.add(key);
      uniqueTasks.push(task);
    }
  }

  // Deduplicate events by title and date
  const uniqueEvents = [];
  const seenEvents = new Set();
  for (const ev of allEvents) {
    const key = `${ev.title.toLowerCase().replace(/[^a-z0-9]/g, '')}_${ev.date}`;
    if (!seenEvents.has(key)) {
      seenEvents.add(key);
      uniqueEvents.push(ev);
    }
  }

  return {
    tasks: uniqueTasks,
    events: uniqueEvents,
    stats: {
      totalProcessed: rawList.length,
      matchedEmails: matchedCount
    }
  };
}

/**
 * Realistic sample payloads generator for Westlake Lutheran Academy and sportsYou
 * Used when testing without live Gmail OAuth credentials or for initial seeding.
 */
export function getSampleEmails() {
  return [
    {
      id: 'msg_wla_001',
      from: 'newsletter@westlakelutheran.org',
      subject: 'Westlake Lutheran Academy - Weekly Wildcat Update & Homework Schedule',
      date: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
      snippet: 'Weekly assignments for Ben (Middle School) and Jade (Elementary), plus upcoming chapel and spirit week notes.',
      body: `
Dear Westlake Lutheran Academy Families,

Here is your weekly academic update for the upcoming week:

Ben's Middle School Assignments:
- Complete Chapter 4 Pre-Algebra Problem Set #1-25 (due Friday, Sep 19)
- Science Fair Project Hypothesis and Materials List (due Monday, Sep 22)
- Read chapters 3-5 of The Giver for English Literature discussion (due Thursday, Sep 18)
- Bible verse memorization: Proverbs 3:5-6 recitation (due Wednesday, Sep 17)

Jade's 4th Grade Assignments:
- Read 20 minutes daily and log on reading chart (due Friday, Sep 19)
- Texas History state symbols worksheet packet (due Thursday, Sep 18)
- Science: Bring leaf samples for photosynthesis lab (due Wednesday, Sep 17)
- Spelling test Unit 4 on Friday morning (due Friday, Sep 19)

Upcoming School Events:
- All-School Chapel Service: Wednesday, Sep 17 at 8:30 AM in WLA Sanctuary
- Westlake Lutheran Spirit Day & Pep Rally: Friday, Sep 19 at 2:15 PM in Main Gym
- Parent-Teacher Conferences: Thursday, Sep 25 from 4:00 PM - 7:30 PM
      `
    },
    {
      id: 'msg_sportsyou_002',
      from: 'alerts@sportsyou.com',
      subject: 'sportsYou: Westlake Middle School Soccer - Practice & Game Schedule',
      date: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
      snippet: 'Coach Henderson posted updates for Ben and the boys soccer team on sportsYou.',
      body: `
New Message from Coach Henderson via sportsYou:

Westlake Lutheran Academy Boys Soccer Schedule for this week:

Ben:
- Practice: Tuesday, Sep 16 from 3:45 PM - 5:15 PM at Westlake Athletic Field
- Home Game vs Concordia Lutheran: Thursday, Sep 18 at 4:30 PM at Westlake Athletic Field (Arrive 3:45 PM in blue kits)
- Weekend Tournament Match: Saturday, Sep 20 at 10:00 AM at St. John's Athletic Complex

Reminders:
- Ben: Turn in signed soccer concussion waiver form to Coach Henderson (due Wednesday, Sep 17)
      `
    },
    {
      id: 'msg_sportsyou_003',
      from: 'notifications@sportsyou.com',
      subject: 'sportsYou: Jade - Westlake Youth Volleyball Clinic & Schedule',
      date: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
      snippet: 'Practice schedule for Jade and 4th Grade girls volleyball on sportsYou.',
      body: `
sportsYou Update from Coach Miller:

Westlake Lutheran Academy Girls Youth Volleyball:

Jade:
- Clinic Practice: Wednesday, Sep 17 from 4:00 PM - 5:15 PM at WLA Auxiliary Gym
- Friendly Scrimmage vs St. Paul: Saturday, Sep 20 at 11:30 AM at Westlake Main Gym
      `
    },
    {
      id: 'msg_wla_004',
      from: 'principal@westlakelutheran.org',
      subject: 'Westlake Lutheran Academy: Middle School Science Field Trip Notice',
      date: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
      snippet: 'Important permission slips and schedule for Ben and 7th/8th grade classes.',
      body: `
Westlake Lutheran Academy Parent Alert:

Middle School Science Field Trip to the Hill Country Science Center:
- Ben: Signed field trip permission slip and $15 lab fee due Friday (due Friday, Sep 19)
- Event: Science Center Field Trip on Tuesday, Sep 23 from 9:00 AM - 2:00 PM at Hill Country Science Center
      `
    }
  ];
}
