"""End-to-end test: runs the real app in Chrome against a fake Supabase and a fake AI provider.
The fake Supabase runs the REAL server function (supabase/functions/refute-ai/index.ts) in the page.

Usage (from the project folder):
    pip install playwright && python -m playwright install chromium
    python tests/e2e/e2e.py
Set CHROME_PATH to use an installed Chrome instead of Playwright's Chromium.
Screenshots are written to tests/e2e/screenshots/.
"""
import json, re, subprocess, time, sys, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SHOTS = Path(os.environ.get('SHOTS_DIR', HERE / 'screenshots'))
SHOTS.mkdir(parents=True, exist_ok=True)
PORT = int(os.environ.get('E2E_PORT', '8765'))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '-d', str(ROOT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = f'http://localhost:{PORT}/'
MOCK_SB = (HERE / 'mock-supabase.js').read_text()
FUNCTION = (ROOT / 'supabase/functions/refute-ai/index.ts').read_text()
CONFIG = """export const CONFIG = { appName: 'Refute', sourceUrl: 'https://github.com/example/refute',
  supabaseUrl: 'https://test.supabase.co', supabaseKey: 'sb_publishable_test' };"""
FAIL_NEXT = [0]
calls = []
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}


def groq(route, request):
    if request.method == 'OPTIONS':
        return route.fulfill(status=204, headers=CORS)
    assert request.headers.get('authorization') == 'Bearer gsk_test_key_1234', 'the saved key is used'
    if request.url.endswith('/models'):
        return route.fulfill(status=200, headers={**CORS, 'content-type': 'application/json'}, body=json.dumps({'data': [
            {'id': 'whisper-large-v3', 'active': True}, {'id': 'openai/gpt-oss-20b', 'active': True}, {'id': 'llama-3.3-70b-versatile', 'active': True}]}))
    body = json.loads(request.post_data)
    calls.append(body)
    if FAIL_NEXT[0]:
        FAIL_NEXT[0] -= 1
        return route.fulfill(status=429, headers={**CORS, 'content-type': 'application/json'}, body=json.dumps({'error': {'message': 'Rate limit reached'}}))
    sysmsg = body['messages'][0]['content']
    if body.get('response_format'):
        user = body['messages'][-1]['content']
        st = ' '.join(l for l in user.split('\n') if l.startswith('STUDENT:')).lower()
        met = []
        if 'bias' in st: met.append(1)
        if 'internet' in st: met.append(2)
        if 'margin of error' in st and 'random' in st: met.append(3)
        content = json.dumps({'met': met, 'notes': f'Covered {len(met)} points so far.'})
    elif 'supportive university tutor' in sysmsg:
        content = "### Why the claim was wrong\nA big sample only shrinks **random** error.\n\n### What you argued well\n- You explained selection bias clearly.\n\n### What you missed\n- Self-selection.\n\n### Try next time\nName who chooses to answer."
    elif 'connection test' in sysmsg:
        content = 'ready'
    elif 'concede sincerely' in sysmsg:
        content = "You're right. I was wrong: a big sample can't fix who was left out, and the margin of error assumed a random sample. Thank you."
    else:
        content = "Hmm, I'm not convinced. With 12,000 people the estimate is very precise. Why would size not help?"
    return route.fulfill(status=200, headers={**CORS, 'content-type': 'application/json'}, body=json.dumps({'choices': [{'message': {'content': content}}]}))


def wire_routes(context):
    context.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=MOCK_SB))
    context.route('**/__fn/refute-ai.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=FUNCTION))
    context.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    context.route('https://fonts.gstatic.com/**', lambda r: r.abort())
    context.route('**/js/config.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=CONFIG))
    context.route('https://api.groq.com/**', groq)


errors = []
def wire(page):
    page.on('console', lambda m: errors.append(f'[{m.type}] {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))

def shot(page, name, full=True):
    page.screenshot(path=str(SHOTS / f'{name}.png'), full_page=full)

def send(page, text):
    page.locator('#msg').fill(text)
    page.locator('#msg').press('Enter')

with sync_playwright() as p:
    chrome = os.environ.get('CHROME_PATH')
    browser = p.chromium.launch(executable_path=chrome, headless=True) if chrome else p.chromium.launch(headless=True)
    # ── Email confirmation: the link signs the teacher in on a fresh page ──
    # (Supabase signs the account in from the link; the site must then claim it.)
    cctx = browser.new_context(viewport={'width': 1280, 'height': 860})
    wire_routes(cctx)
    cctx.add_init_script("""if (!localStorage.getItem('mockdb.v2')) localStorage.setItem('mockdb.v2', JSON.stringify({
      users: [{ id: 'u-confirmed', email: 'new@diu.edu.bd', password: 'secret123', user_metadata: { full_name: 'Confirmed Teacher' } }],
      session: { user: { id: 'u-confirmed', email: 'new@diu.edu.bd', user_metadata: { full_name: 'Confirmed Teacher' } }, access_token: 'token-u-confirmed' },
      app_settings: { owner_id: null, teacher_name: '', institution: '' },
      ai_settings: null, courses: [], tasks: [], attempts: [] }));""")
    cpage = cctx.new_page(); wire(cpage)
    cpage.goto(BASE)
    expect(cpage.get_by_role('heading', name='Settings')).to_be_visible()
    expect(cpage.locator('[data-teacher]')).to_have_text('Confirmed Teacher')
    cctx.close()
    # Signing in from the sign-in page also claims an unclaimed site
    # (for when the email link was opened on another device).
    cctx = browser.new_context(viewport={'width': 1280, 'height': 860})
    wire_routes(cctx)
    cctx.add_init_script("""if (!localStorage.getItem('mockdb.v2')) localStorage.setItem('mockdb.v2', JSON.stringify({
      users: [{ id: 'u-confirmed', email: 'new@diu.edu.bd', password: 'secret123', user_metadata: { full_name: 'Confirmed Teacher' } }],
      session: null, app_settings: { owner_id: null, teacher_name: '', institution: '' },
      ai_settings: null, courses: [], tasks: [], attempts: [] }));""")
    cpage = cctx.new_page(); wire(cpage)
    cpage.goto(BASE + '#/setup')
    cpage.get_by_role('link', name='Sign in').last.click()
    cpage.get_by_label('Email').fill('new@diu.edu.bd')
    cpage.get_by_label('Password').fill('secret123')
    cpage.get_by_role('button', name='Sign in').click()
    expect(cpage.get_by_role('heading', name=re.compile('courses|Settings', re.I))).to_be_visible()
    expect(cpage.locator('[data-teacher]')).to_have_text('Confirmed Teacher')
    cctx.close()

    ctx = browser.new_context(viewport={'width': 1280, 'height': 860})
    wire_routes(ctx)
    page = ctx.new_page(); wire(page)

    # ── First run: the teacher sets up the installation ───────────
    page.goto(BASE)
    expect(page.get_by_role('link', name='Set up Refute')).to_be_visible()
    shot(page, '01-first-run')
    page.get_by_role('link', name='Set up Refute').click()
    page.get_by_label('Your name').fill('Musabbir Hasan Sammak')
    page.get_by_label('Email').fill('teacher@diu.edu.bd')
    page.get_by_label('Password').fill('secret123')
    page.get_by_role('button', name='Create teacher account').click()
    expect(page.get_by_role('heading', name='Settings')).to_be_visible()
    expect(page.locator('[data-teacher]')).to_have_text('Musabbir Hasan Sammak')
    expect(page.locator('.ai-status')).to_contain_text('Not set up yet')

    # AI settings: key and model, kept on the server
    page.get_by_label('Groq API key').fill('gsk_test_key_1234')
    page.get_by_role('button', name='Load models').click()
    expect(page.locator('.status')).to_contain_text('models available')
    expect(page.locator('select[name=model]')).to_have_value('llama-3.3-70b-versatile')
    page.get_by_role('button', name='Save AI settings').click()
    expect(page.locator('.ai-status')).to_contain_text('ending in 1234')
    expect(page.get_by_label('Groq API key')).to_have_value('')
    assert 'gsk_test_key_1234' not in page.content(), 'the key is not left in the page'
    page.get_by_role('button', name='Test saved settings').click()
    expect(page.locator('.status')).to_contain_text('work')
    page.get_by_label('Institution').fill('Daffodil International University')
    page.get_by_role('button', name='Save details').click()
    expect(page.locator('#footer')).to_contain_text('Refute for Musabbir Hasan Sammak, Daffodil International University')
    shot(page, '02-settings')

    # ── Course with a class list, and a task ──────────────────────
    page.get_by_role('link', name='Courses').click()
    page.get_by_role('button', name='New course').click()
    page.get_by_label('Course title').fill('Statistics 101')
    page.get_by_label('Course code').fill('STA101')
    page.get_by_role('button', name='Create course').click()
    expect(page.get_by_role('heading', level=1)).to_contain_text('Statistics 101')
    page.locator('textarea[name=roster]').fill('221-35-1042\n221-35-1043, 221-35-1044 221-35-1042')
    page.get_by_role('button', name='Save class list').click()
    expect(page.locator('.roster')).to_contain_text('Only these 3 student IDs')
    shot(page, '03-course')
    page.get_by_role('link', name='Create the first task').click()
    expect(page.get_by_label('Task title')).to_have_value('The 12,000-person Facebook poll')
    page.get_by_role('radio', name="Probability: the gambler's fallacy").click()
    expect(page.get_by_label('Task title')).to_have_value('Is the captain "due" to win the toss?')
    page.get_by_role('radio', name='Sampling bias: the huge online poll').click()
    page.get_by_label('Messages each student may send').fill('8')
    page.get_by_role('button', name='Create task', exact=True).click()
    expect(page.get_by_role('heading', level=1)).to_contain_text('Facebook poll')
    link = page.locator('#share-link').input_value()
    expect(page.locator('.switch-label')).to_contain_text('Link is open')
    shot(page, '04-task')

    # ── Teacher preview ───────────────────────────────────────────
    page.get_by_role('link', name='Try it yourself').click()
    expect(page.locator('.preview-flag')).to_be_visible()
    send(page, 'A large sample does not remove selection bias.')
    expect(page.locator('.msg-ai')).to_have_count(2)
    expect(page.locator('.judge-panel .is-met')).to_have_count(1)
    shot(page, '05-preview')
    page.get_by_role('button', name='Give up and see feedback').click()
    page.get_by_role('button', name='Stop and see feedback').click()
    expect(page.get_by_role('heading', level=1)).to_contain_text('You stopped before convincing Tanvir')
    expect(page.locator('.mark-num')).to_have_text('35')

    # ── A student (no account) ────────────────────────────────────
    page.locator('#signout').click()
    expect(page.get_by_role('link', name='Teacher sign in')).to_be_visible()
    page.goto(link)
    expect(page.get_by_role('heading', level=1)).to_contain_text('Facebook poll')
    expect(page.locator('.intro')).to_contain_text('Musabbir Hasan Sammak')
    assert 'margin of error only describes' not in page.content(), 'the points never reach the student page'
    page.get_by_label('Student ID').fill('999-99-9999')
    page.get_by_label('Email').fill('outsider@example.com')
    page.get_by_role('button', name='Start the debate').click()
    expect(page.locator('.form-error')).to_contain_text("isn't on this course's class list")
    page.get_by_label('Student ID').fill('221-35-1042')
    page.get_by_label('Email').fill('ayesha@diu.edu.bd')
    shot(page, '06-student-entry')
    page.get_by_role('button', name='Start the debate').click()
    expect(page.locator('.msg-ai')).to_have_count(1)
    expect(page.locator('.case')).to_contain_text('221-35-1042')
    send(page, "You're wrong, that's obviously not true.")
    expect(page.locator('.msg-ai')).to_have_count(2)
    expect(page.locator('.meter-row')).to_contain_text('0 of 4')
    # the AI's limit is reached once: the message comes back for a retry
    FAIL_NEXT[0] = 1
    send(page, 'More data cannot fix selection bias, the error is systematic.')
    expect(page.locator('.chat-status .notice-error')).to_contain_text('limit')
    expect(page.locator('#msg')).to_have_value('More data cannot fix selection bias, the error is systematic.')
    expect(page.locator('.msg-student')).to_have_count(1)
    shot(page, '07-error', full=False)
    page.get_by_role('button', name='Retry').click()
    expect(page.locator('.meter-row')).to_contain_text('1 of 4')
    expect(page.locator('#msg')).to_be_enabled()
    # closing the tab and coming back with the same ID
    page.goto(BASE)
    page.goto(link)
    expect(page.get_by_label('Student ID')).to_have_value('221-35-1042')
    page.get_by_role('button', name='Start the debate').click()
    expect(page.locator('.msg-student')).to_have_count(2)
    expect(page.locator('.meter-row')).to_contain_text('1 of 4')
    send(page, 'Rural and older people without internet access are not on Facebook, so they are excluded.')
    expect(page.locator('.meter-row')).to_contain_text('2 of 4')
    shot(page, '08-debate', full=False)
    send(page, 'And the margin of error assumes a random sample, which this is not.')
    expect(page.get_by_role('heading', level=1)).to_contain_text('You convinced Tanvir', timeout=10000)
    expect(page.locator('.mark-num')).to_have_text('85')
    expect(page.locator('.checklist .is-met')).to_have_count(3)
    expect(page.get_by_role('link', name='Try again')).to_be_visible()
    shot(page, '09-student-result')
    result_url = page.url
    page.reload()
    expect(page.get_by_role('heading', level=1)).to_contain_text('You convinced Tanvir')

    # Mobile view of the result
    m = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, storage_state=ctx.storage_state())
    wire_routes(m)
    mp = m.new_page(); wire(mp)
    mp.goto(result_url)
    expect(mp.get_by_role('heading', level=1)).to_contain_text('You convinced Tanvir')
    shot(mp, '10-mobile-result')
    m.close()

    # ── The teacher sees the result ───────────────────────────────
    page.goto(BASE + '#/login')
    page.get_by_label('Email').fill('teacher@diu.edu.bd')
    page.get_by_label('Password').fill('secret123')
    page.get_by_role('button', name='Sign in').click()
    expect(page.get_by_role('heading', name='Your courses')).to_be_visible()
    page.get_by_role('link', name=re.compile('Statistics 101')).click()
    expect(page.locator('.list-meta').first).to_contain_text('1 attempt')
    page.locator('.list-row').first.click()
    expect(page.locator('.table tbody tr')).to_have_count(1)
    expect(page.locator('.table')).to_contain_text('221-35-1042')
    expect(page.locator('.table')).to_contain_text('ayesha@diu.edu.bd')
    expect(page.locator('.figures')).to_contain_text('100%')
    shot(page, '11-dashboard')
    with page.expect_download() as dl:
        page.get_by_role('button', name='Download CSV').click()
    csv = open(dl.value.path(), encoding='utf-8-sig').read()
    assert '221-35-1042' in csv and 'ayesha@diu.edu.bd' in csv and 'llama-3.3-70b-versatile' in csv, csv
    page.get_by_role('link', name='View').click()
    expect(page.get_by_role('heading', level=1)).to_contain_text('221-35-1042 convinced Tanvir')
    expect(page.locator('.judge-note')).to_have_count(4)
    page.locator('.transcript-wrap summary').click()
    shot(page, '12-teacher-result')

    # Switching the link off stops students
    page.get_by_role('link', name='All results for this task').click()
    page.locator('.switch').click()
    expect(page.locator('.switch-label')).to_contain_text('Link is off')
    page.wait_for_timeout(200)
    page.locator('#signout').click()
    page.goto(link)
    expect(page.locator('.intro-start')).to_contain_text('switched this link off')
    shot(page, '13-link-off')
    browser.close()

srv.terminate()
unexpected = [e for e in errors if '429' not in e]  # the 429 is the simulated rate limit
if unexpected:
    print('Unexpected browser errors:', *unexpected, sep='\n  ')
    sys.exit(1)
print(f'End-to-end test passed ({len(calls)} AI requests). Screenshots in {SHOTS}')
