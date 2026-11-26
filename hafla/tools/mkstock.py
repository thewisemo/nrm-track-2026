#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
بيقرا الرصيد الحي من الهب وبيطلع stock.json اللي صفحة الحفلة بتقرا منه.
بيشتغل لوحده كل يوم الصبح. مابيلمسش أي حاجة في الهب — قراءة بس.
"""
import json, urllib.request, datetime, sys, os

API = ('https://hub.wisemo.shop/api/public.php'
       '?t=normandy&a=products&grp=main&per=100&page=%d')

# ترتيب النشر الثابت. أي موديل رصيده وقع بيتشال أوتوماتيك وبيجي اللي بعده.
PLAN = ['702-Havan', '3187-جراي', '426006-Black', '2025-Black', 'S102-Brown-جلد']
# البديل المكتوب في الخطة لكل موديل مخطّط — بيتستعمل طالما لسه رصيده كويس
ALT = {'702-Havan': '6853-بيج', '3187-جراي': '3191-جراي',
       '426006-Black': '426007-Black', '2025-Black': 'S104-Havan',
       'S102-Brown-جلد': 'S80-1-Black'}
START = datetime.date(2026, 11, 26)     # أول يوم في الحفلة
MIN_BRANCHES = 3                        # تحت كده الموديل مينزلش

AR_BR = {'tanta':'طنطا','mahalla':'المحلة','mansoura':'المنصورة','zagazig':'الزقازيق',
         'damanhour':'دمنهور','nasrcity':'مدينة نصر','dokki':'الدقي','october':'أكتوبر',
         'smouha':'سموحة','tenth':'العاشر من رمضان'}
AR_USE = {'Sport':'رياضي','Sports':'رياضي','Casual':'كاجوال','Classic':'كلاسيك',
          'Smart':'سمارت','Hav':'هافان','Men':'رجالي'}
AR_COL = {'Black':'أسود','White':'أبيض','Brown':'بني','Havan':'هافان','Grey':'جراي',
          'Gray':'جراي','Beige':'بيج','Navy':'كحلي','Blue':'أزرق','Red':'أحمر',
          'Green':'أخضر','Yellow':'أصفر','Orange':'برتقالي','Silver':'فضي','Gold':'دهبي'}


def ar_col(c):
    out = []
    for w in str(c or '').replace('-', ' ').split():
        out.append(AR_COL.get(w, AR_COL.get(w.capitalize(), w)))
    return ' '.join(out)


def n_branches(k):
    if k == 1:
        return 'في فرع واحد'
    if k == 2:
        return 'في فرعين'
    if k == 10:
        return 'في العشر فروع'
    if 3 <= k <= 9:
        return 'في %d فروع' % k
    return 'في %d فرع' % k


def auto_cap(m):
    nm = (m['n'] + ' ' + m['colar']).strip()
    l1 = '%s — كان %d، بقى %d.' % (nm, m['was'], m['now'])
    bits = [b for b in (m['use'], m['mat']) if b and b != m['colar']]
    l2 = '%s، %s' % ('، '.join(bits) if bits else 'متاح', n_branches(len(m['br'])))
    if m['sz']:
        l2 += '، ومقاساته من %d لـ %d' % (m['sz'][0], m['sz'][1])
    return l1 + '\n' + l2 + '.\nشوف مقاسك متاح فين من اللينك.'


def fetch():
    rows, page = [], 1
    while True:
        req = urllib.request.Request(API % page, headers={'User-Agent': 'normandy-hafla/1'})
        d = json.load(urllib.request.urlopen(req, timeout=40))
        rows += d.get('rows', [])
        if page >= int(d.get('pages', 1)):
            break
        page += 1
    return rows


def shape(r):
    st = r.get('stock') or {}
    st = {k: sorted(set(v)) for k, v in st.items() if v}
    sizes = sorted({s for v in st.values() for s in v})
    return {
        'code': r['code'],
        'n': str(r.get('name') or r['code']),
        'col': r.get('color') or '',
        'colar': ar_col(r.get('color')),
        'use': AR_USE.get(r.get('use') or '', r.get('use') or ''),
        'mat': r.get('material') or '',
        'was': int(r.get('price') or 0),
        'now': int(r.get('sale_price') or 0),
        'ncol': len(r.get('colors') or []) or 1,
        'qty': sum(len(v) for v in st.values()),
        'br': [AR_BR.get(k, k) for k in st],
        'brk': list(st),
        'sz': [sizes[0], sizes[-1]] if sizes else [],
        'img': r.get('img') or '',
    }


def main():
    rows = fetch()
    offers = [shape(r) for r in rows
              if (r.get('sale_price') or 0) > 0 and (r.get('stock') or {})]
    offers = [m for m in offers if m['qty'] > 0]
    for m in offers:
        m['cap'] = auto_cap(m)
    live = {m['code']: m for m in offers}

    # الترتيب: خطة النشر الأول، وبعدها الباقي بالرصيد من الأكبر للأصغر
    rest = sorted([m for m in offers if m['code'] not in PLAN],
                  key=lambda m: -m['qty'])
    order = [c for c in PLAN if c in live] + [m['code'] for m in rest]
    valid = [c for c in order if len(live[c]['br']) >= MIN_BRANCHES]

    today = datetime.date.today()
    i = (today - START).days
    if i < 0:
        i = 0
    pick = sub = None
    swapped = False
    if valid:
        planned = order[i] if 0 <= i < len(order) else None
        if planned and planned in valid:
            pick = planned
        else:
            pick = valid[i % len(valid)]
            swapped = bool(planned)
        nxt = [c for c in valid if c != pick]
        planned_alt = ALT.get(pick)
        if planned_alt and planned_alt in nxt:
            sub = planned_alt
        else:
            same = [c for c in nxt if live[c]['use'] == live[pick]['use']]
            sub = (same or nxt or [None])[0]

    out = {
        'at': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'),
        'day': i + 1,
        'pick': pick,
        'sub': sub,
        'swapped': swapped,
        'n_offers': len(offers),
        'n_sizes': sum(m['qty'] for m in offers),
        'order': order,
        'models': {m['code']: m for m in offers},
    }
    dest = sys.argv[1] if len(sys.argv) > 1 else 'stock.json'
    os.makedirs(os.path.dirname(dest) or '.', exist_ok=True)
    with open(dest, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('models=%d sizes=%d pick=%s sub=%s swapped=%s -> %s'
          % (len(offers), out['n_sizes'], pick, sub, swapped, dest))


if __name__ == '__main__':
    main()
