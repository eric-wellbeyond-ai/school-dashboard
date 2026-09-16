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

// Determine if the email originates from Westlake Lutheran Academy, sportsYou, or related school portals
export function identifySource(email) {
  const textToScan = `${email.from} ${email.subject} ${email.snippet}`.toLowerCase();

  const isSportsYou = 
    textToScan.includes('sportsyou') || 
    textToScan.includes('sports you') || 
    textToScan.includes('no-reply@sportsyou.com') ||
    textToScan.includes('@sportsyou');

  const isWestlake = 
    textToScan.includes('westlake lutheran') || 
    textToScan.includes('westlake academy') || 
    textToScan.includes('westlake') || 
    textToScan.includes('@westlakelutheran.org') ||
    textToScan.includes('wla ') ||
    textToScan.includes('blackbaud') ||
    textToScan.includes('westlakelutheran.myschoolapp.com') ||
    textToScan.includes('myea.blackbaudschool.com') ||
    textToScan.includes('myschoolapp');

  if (isSportsYou) return 'sportsYou';
  if (isWestlake) return 'Westlake Lutheran Academy';

  // If email mentions Ben or Jade alongside academic/school keywords, treat as school communication
  const mentionsStudent = /\b(ben|benjamin|jade)\b/i.test(textToScan);
  const mentionsSchool = /\b(homework|assignment|teacher|grade|class|exam|quiz|school|athletics|practice|game)\b/i.test(textToScan);
  if (mentionsStudent && mentionsSchool) {
    return 'Westlake Lutheran Academy';
  }

  return null;
}

// Determine student relevance ("Ben", "Jade", or "Both")
export function detectStudent(text) {
  if (!text) return null;
  const hasBen = /\bBen\b/i.test(text) || /\bBenjamin\b/i.test(text) || /\b(high school|hs\b|high school meet|ap world)\b/i.test(text);
  const hasJade = /\bJade\b/i.test(text) || /\b(middle school|ms wildcat|ms volleyball|ms\b|ms xc)\b/i.test(text);

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

  // Skip outgoing emails sent by parents (e.g., questions sent to teachers about travel/absences)
  const isFromParent = /(hifismith@gmail\.com|stefanicsmith@gmail\.com|eric smith|stefani smith)/i.test(email.from || '');
  if (isFromParent) {
    return [];
  }

  const rawBody = email.body || '';
  const cleanBody = rawBody.replace(/<[^>]+>/g, ' ').replace(/&#160;/g, ' ').replace(/&amp;/g, '&');
  const emailWideStudent = detectStudent(email.subject) || detectStudent(email.from);

  // ----------------------------------------------------
  // 1. Specialized Parser for Blackbaud (myschoolapp.com) & Teacher Portals
  // ----------------------------------------------------
  const isBlackbaud = (email.from || '').includes('myschoolapp.com') || cleanBody.includes('Student Name:');
  if (isBlackbaud) {
    const studentMatch = cleanBody.match(/Student Name:\s*([A-Za-z]+)/i);
    const authorMatch = cleanBody.match(/Author Name:\s*([A-Za-z\s\.]+?)(?=\s+Comment|\s*$)/i);
    const commentTypeMatch = cleanBody.match(/Comment Type:\s*([A-Za-z\s]+?)(?=\s+Comment:|\s*$)/i);

    const bbStudent = studentMatch 
      ? (studentMatch[1].toLowerCase().includes('ben') ? 'Ben' : studentMatch[1].toLowerCase().includes('jade') ? 'Jade' : 'Ben')
      : emailWideStudent || 'Ben';
    const author = authorMatch ? authorMatch[1].trim() : '';
    const authorSuffix = author ? ` (${author})` : '';

    // A. Check for Rescheduled Quizzes / Tests (e.g., "The quiz is moved to Monday!")
    const movedPattern = /(?:quiz|test|exam)\s+is\s+moved\s+to\s+([A-Za-z]+,?\s*(?:Sept(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?)?\s*\d{0,2})/i;
    const movedMatch = cleanBody.match(movedPattern);
    if (movedMatch) {
      const dueDate = movedMatch[1].trim();
      tasks.push({
        id: `task_${email.id}_quiz_rescheduled_${bbStudent.toLowerCase()}`,
        title: `Science Quiz (Rescheduled to ${dueDate})${authorSuffix}`,
        student: bbStudent,
        course: detectCourse('Science ' + author + ' ' + cleanBody),
        dueDate: dueDate,
        source: 'Westlake Lutheran Academy',
        completed: false,
        priority: 'high',
        emailSubject: email.subject,
        emailDate: email.date
      });
    }

    // B. Check for Tests / Exams
    let testMatch = null;
    let testTitle = '';
    let testDueDate = '';

    const explicitTestMatch = cleanBody.match(/(?:for\s+their|for\s+the|our|the)\s+([A-Za-z0-9\s'-]{3,30}?(?:test|quiz|exam))\s+(?:will\s+be|which\s+is|is\s+on|is|on)\s+([A-Za-z]+,?\s*(?:Sept(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?)?\s*\d{0,2}(?:\/\d{1,2})?|[A-Za-z]+)/i);
    const genericTestMatch = cleanBody.match(/(?:students\s+have\s+(?:their|a)|there\s+is\s+a|reminder\s+(?:of|about)\s+the)\s+([A-Za-z0-9\s'-]{0,20}?(?:test|quiz|exam))\s+(?:will\s+be|which\s+is|is\s+on|is|on)\s+([A-Za-z]+,?\s*(?:Sept(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?)?\s*\d{0,2}(?:\/\d{1,2})?|[A-Za-z]+)/i);

    if (explicitTestMatch) {
      testMatch = explicitTestMatch;
      let raw = explicitTestMatch[1].trim().replace(/^(?:the|our|their)\s+/i, '');
      testTitle = raw.charAt(0).toUpperCase() + raw.slice(1);
      testDueDate = explicitTestMatch[2].trim();
    } else if (genericTestMatch) {
      testMatch = genericTestMatch;
      let raw = genericTestMatch[1].trim().replace(/^(?:the|our|their)\s+/i, '');
      if (!raw || /^(?:test|quiz|exam)$/i.test(raw)) {
        raw = 'Classroom Test';
      }
      testTitle = raw.charAt(0).toUpperCase() + raw.slice(1);
      testDueDate = genericTestMatch[2].trim();
    }

    if (testMatch && !movedMatch) {
      tasks.push({
        id: `task_${email.id}_test_${bbStudent.toLowerCase()}`,
        title: `${testTitle}${authorSuffix}`,
        student: bbStudent,
        course: detectCourse(testTitle + ' ' + author + ' ' + cleanBody),
        dueDate: testDueDate,
        source: 'Westlake Lutheran Academy',
        completed: false,
        priority: 'high',
        emailSubject: email.subject,
        emailDate: email.date
      });
    }

    // C. Check for Wayground / Classlink review assignments (e.g. Dianna DesJardins for Jade)
    if (/Wayground/i.test(cleanBody)) {
      const isOptional = /optional/i.test(cleanBody);
      tasks.push({
        id: `task_${email.id}_wayground_${bbStudent.toLowerCase()}`,
        title: `Wayground Review Assignment${isOptional ? ' (Optional)' : ''} via Classlink${authorSuffix}`,
        student: bbStudent,
        course: detectCourse(author + ' ' + cleanBody),
        dueDate: testMatch ? testMatch[2].trim() : 'Monday',
        source: 'Westlake Lutheran Academy',
        completed: false,
        priority: isOptional ? 'medium' : 'high',
        emailSubject: email.subject,
        emailDate: email.date
      });
    }

    // D. Check for Review Guides / Study Guides
    if (/study guide|review guide/i.test(cleanBody)) {
      const isGraded = /grade|due|turn in/i.test(cleanBody);
      let guideTitle = 'Study & Review Guide';
      if (/Unit\s*\d+\s+Study\s+Guide/i.test(cleanBody)) {
        const uMatch = cleanBody.match(/Unit\s*\d+\s+Study\s+Guide/i);
        guideTitle = uMatch[0];
      } else if (/Short\s+Story/i.test(cleanBody)) {
        guideTitle = 'Short Story Review & Study Guide';
      } else {
        const guideTitleMatch = cleanBody.match(/([A-Za-z0-9\s'-]{2,25}?(?:study guide|review guide))/i);
        if (guideTitleMatch && !/the\s+study|a\s+study|their\s+study/i.test(guideTitleMatch[1])) {
          guideTitle = guideTitleMatch[1].trim();
        }
      }

      const dueMatch = cleanBody.match(/(?:due\s+on\s+(?:the\s+day\s+of\s+the\s+test,?\s*)?|due\s+(?:is\s+)?)([A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2}|[A-Za-z]+,?\s+\d{1,2}(?:\/\d{1,2})?|[A-Za-z]+)/i);
      const dueDate = dueMatch ? dueMatch[1].trim() : (testMatch ? testMatch[2].trim() : 'Due on test day');

      tasks.push({
        id: `task_${email.id}_study_guide_${bbStudent.toLowerCase()}`,
        title: `Complete ${guideTitle}${isGraded ? ' (Graded)' : ''}${authorSuffix}`,
        student: bbStudent,
        course: detectCourse(guideTitle + ' ' + author + ' ' + cleanBody),
        dueDate: dueDate,
        source: 'Westlake Lutheran Academy',
        completed: false,
        priority: isGraded ? 'high' : 'medium',
        emailSubject: email.subject,
        emailDate: email.date
      });
    }

    // E. Check for Novel reading / book requirements (e.g. The Scarlet Letter)
    if (/novel|hard copy of the text/i.test(cleanBody)) {
      if (/hard copy of the text|starting our (?:first\s+)?class novel/i.test(cleanBody)) {
        const novelMatch = cleanBody.match(/(?:novel|book)\s+([A-Za-z0-9\s'-]+?)(?=\s+on\s+\d|\s+by|\s*\.|\s*,)/i);
        const novelName = novelMatch ? novelMatch[1].trim() : (cleanBody.includes('Scarlet Letter') ? 'The Scarlet Letter' : 'class novel');
        const dueMatch = cleanBody.match(/(?:on|by|due)\s+(\d{1,2}\/\d{1,2}|[A-Za-z]+\s+\d{1,2})/i);
        const dueDate = dueMatch ? dueMatch[1].trim() : 'Upcoming';

        tasks.push({
          id: `task_${email.id}_novel_text_${bbStudent.toLowerCase()}`,
          title: `Obtain hard copy of novel '${novelName}'${authorSuffix}`,
          student: bbStudent,
          course: 'English / ELA',
          dueDate: dueDate,
          source: 'Westlake Lutheran Academy',
          completed: false,
          priority: 'medium',
          emailSubject: email.subject,
          emailDate: email.date
        });
      } else if (/mix of in-class reading and at home reading|staying on top/i.test(cleanBody)) {
        tasks.push({
          id: `task_${email.id}_novel_${bbStudent.toLowerCase()}`,
          title: `Read assigned novel chapters (at-home reading)${authorSuffix}`,
          student: bbStudent,
          course: 'English / ELA',
          dueDate: 'Ongoing',
          source: 'Westlake Lutheran Academy',
          completed: false,
          priority: 'medium',
          emailSubject: email.subject,
          emailDate: email.date
        });
      }
    }

    // F. Check for Quill diagnostics activity pack (Emily Falvey)
    if (/Quill diagnostics|activity pack/i.test(cleanBody)) {
      tasks.push({
        id: `task_${email.id}_quill_${bbStudent.toLowerCase()}`,
        title: `Complete Quill Diagnostic Activities (20 pack)${authorSuffix}`,
        student: bbStudent,
        course: 'English / ELA',
        dueDate: 'Check Blackbaud',
        source: 'Westlake Lutheran Academy',
        completed: false,
        priority: 'medium',
        emailSubject: email.subject,
        emailDate: email.date
      });
    }

    // G. Check for Science Space Unit & instructional activities (Jade, Crystal Dube)
    if (/Space Unit/i.test(cleanBody) && /instructional activities|vocabulary illustration/i.test(cleanBody)) {
      tasks.push({
        id: `task_${email.id}_space_${bbStudent.toLowerCase()}`,
        title: `Space Unit: Review Instructional Activities & Vocabulary Illustration${authorSuffix}`,
        student: bbStudent,
        course: 'Science',
        dueDate: 'This week',
        source: 'Westlake Lutheran Academy',
        completed: false,
        priority: 'medium',
        emailSubject: email.subject,
        emailDate: email.date
      });
    }

    // If specialized patterns caught tasks, return them
    if (tasks.length > 0) {
      return tasks;
    }
  }

  // ----------------------------------------------------
  // 2. Direct Teacher Emails (e.g. Ms. Dube "Ben's notes", Quiz topics)
  // ----------------------------------------------------
  if (/topics for the quiz are/i.test(cleanBody) || (/quiz/i.test(cleanBody) && /PTE|Mendeleev|wavelength|valence/i.test(cleanBody))) {
    const student = emailWideStudent || (cleanBody.includes('Ben') ? 'Ben' : 'Jade');
    tasks.push({
      id: `task_${email.id}_quiz_${student.toLowerCase()}`,
      title: `Study for Science Quiz (Periodic Table, EMS, & Percent Abundance) - Ms. Dube`,
      student: student,
      course: 'Science',
      dueDate: 'This week',
      source: 'Westlake Lutheran Academy',
      completed: false,
      priority: 'high',
      emailSubject: email.subject,
      emailDate: email.date
    });
    return tasks;
  }

  // ----------------------------------------------------
  // 3. Bullet & Section Parser for School Newsletters
  // ----------------------------------------------------
  const lines = (email.body || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const taskKeywords = [
    'homework', 'assignment', 'project', 'quiz', 'test', 'exam',
    'due', 'complete', 'read chapter', 'worksheet', 'turn in',
    'bring', 'practice log', 'signed form', 'permission slip', 'study',
    'problem set', 'memorization', 'recitation', 'packet', 'waiver',
    'study guide', 'review guide'
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
      currentSectionStudent = null;
      continue;
    }

    if (line.endsWith(':') || line.startsWith('Dear ') || line.startsWith('Here is your') || line.startsWith('New Message from')) {
      continue;
    }

    const lowerLine = line.toLowerCase();

    // Skip quoted replies, email threads, and parent travel inquiries
    if (line.startsWith('>') || line.startsWith('&gt;') || lowerLine.startsWith('on sep') || lowerLine.startsWith('wrote:') || lowerLine.includes('travel for thanksgiving') || lowerLine.includes('unexcused absence') || lowerLine.includes('missing class')) {
      continue;
    }
    const isBullet = /^[-*•]\s+/.test(line) || /^\d+[\.\)]\s+/.test(line);
    const hasTaskKeyword = taskKeywords.some(keyword => lowerLine.includes(keyword));

    const isEvent = /^(?:practice|home game|away game|weekend tournament|all-school chapel|pep rally|clinic practice|friendly scrimmage|event:)/i.test(line.replace(/^[-*•\d\.\)\s]+/, ''));
    if (isEvent) {
      continue;
    }

    if ((isBullet && hasTaskKeyword) || (hasTaskKeyword && (lowerLine.includes('due') || lowerLine.includes('turn in')))) {
      const lineStudent = detectStudent(line) || currentSectionStudent || emailWideStudent;
      if (!lineStudent) continue;

      let cleanTitle = line
        .replace(/^[-*•\d\.\)\s]+/, '')
        .replace(/^(Ben|Jade):\s*/i, '')
        .trim();

      if (/Grandparent['’]s Day skit/i.test(cleanTitle) && /memoriz/i.test(cleanTitle)) {
        cleanTitle = "Memorize lines for Grandparent's Day Skit (Ava, Niko, Jade, Bryce)";
      }

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

  // Skip outgoing emails sent by parents
  const isFromParent = /(hifismith@gmail\.com|stefanicsmith@gmail\.com|eric smith|stefani smith)/i.test(email.from || '');
  if (isFromParent) {
    return [];
  }

  const lines = (email.body || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const emailWideStudent = detectStudent(email.subject);

  // Resolve clean sender/poster name
  let senderName = email.from || '';
  if (source === 'sportsYou') {
    const postMatch = (email.subject || '').match(/^([A-Za-z\s'-]+?)\s+posted\s+in/i);
    if (postMatch && postMatch[1]) {
      senderName = `${postMatch[1].trim()} (via sportsYou)`;
    } else {
      senderName = email.from || 'sportsYou';
    }
  }

  // If email is a direct sportsYou event alert, extract primary event from subject/snippet
  if (source === 'sportsYou' && (email.subject.includes('game has been added') || email.subject.includes('Meet') || email.subject.includes('Practice has been'))) {
    let subjectTitle = email.subject.replace(/ has been (?:added to|updated on).*$/i, '').trim();
    if (subjectTitle.toLowerCase() === 'a game') {
      const match = (email.snippet || '').match(/(?:invited to|playing|event:?)\s*([A-Za-z0-9\s&'-]{4,40})/i);
      if (match) subjectTitle = match[1].trim();
    }
    const student = emailWideStudent || (email.subject.toLowerCase().includes('ms xc') || email.subject.toLowerCase().includes('soccer') ? 'Ben' : 'Jade');
    events.push({
      id: `ev_subj_${email.id}`,
      title: subjectTitle,
      student: student,
      date: new Date(email.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      time: 'Check sportsYou',
      location: 'Athletic Field / Course',
      source: 'sportsYou',
      type: 'sports',
      description: email.snippet || email.subject,
      emailId: email.id,
      emailFrom: senderName,
      rawEmailFrom: email.from || '',
      emailSubject: email.subject || '',
      emailDate: email.date || '',
      emailBody: email.body || email.snippet || ''
    });
  }

  const eventKeywords = [
    'game', 'practice', 'match', 'tournament', 'scrimmage', 'meet',
    'chapel', 'assembly', 'concert', 'field trip', 'spirit day', 'pep rally', 'clinic'
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

    // Filter conversational sentences, personal notes, or cancellation announcements
    const isConversational = /(mistake|hope this helps|volunteer spots|if you’re able|if you are able|looking forward|thank you|blessings|reached out|noticed some|reviewing these|i went ahead|cancelled|the good news|new game on sportsyou|this game has been|has been removed)/i.test(lowerLine);
    if (isConversational) continue;

    // Must not be an assignment
    if (lowerLine.includes('problem set') || lowerLine.includes('worksheet') || lowerLine.includes('memorization') || lowerLine.includes('study guide') || lowerLine.includes('permission slip')) {
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
      description: line.replace(/^[-*•\d\.\)\s]+/, '').trim(),
      emailId: email.id,
      emailFrom: senderName,
      rawEmailFrom: email.from || '',
      emailSubject: email.subject || '',
      emailDate: email.date || '',
      emailBody: email.body || email.snippet || ''
    });
  }

  return events;
}

/**
 * Main parser module function
 */
export function parseEmailPayloads(payloads, options = {}) {
  if (!payloads) {
    return { tasks: [], events: [], emails: [], stats: { totalProcessed: 0, matchedEmails: 0 } };
  }

  const daysBack = options.daysBack || 14;
  const cutoffTime = Date.now() - (daysBack * 24 * 60 * 60 * 1000);

  const rawList = Array.isArray(payloads) ? payloads : [payloads];
  const allTasks = [];
  const allEvents = [];
  const matchedEmails = [];
  let matchedCount = 0;

  for (const item of rawList) {
    const email = normalizeEmail(item);
    if (!email) continue;

    // Filter by timeframe cutoff
    const emailTime = new Date(email.date).getTime();
    if (!isNaN(emailTime) && emailTime < cutoffTime) {
      continue;
    }

    const source = identifySource(email);
    // Only process emails originating from Westlake Lutheran Academy or sportsYou
    if (!source) continue;

    matchedCount++;

    const tasks = extractTasksFromEmail(email, source);
    const events = extractEventsFromEmail(email, source);

    allTasks.push(...tasks);
    allEvents.push(...events);

    matchedEmails.push({
      id: email.id,
      from: email.from,
      subject: email.subject,
      snippet: email.snippet,
      date: email.date,
      source: source,
      tasksCount: tasks.length,
      eventsCount: events.length
    });
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
    timeframe: `Last ${daysBack} days`,
    tasks: uniqueTasks,
    events: uniqueEvents,
    emails: matchedEmails,
    stats: {
      totalProcessed: rawList.length,
      matchedEmails: matchedCount,
      tasksFound: uniqueTasks.length,
      eventsFound: uniqueEvents.length
    }
  };
}

// No synthetic sample emails - all communications are parsed directly from live Gmail
export function getSampleEmails() {
  return [];
}
