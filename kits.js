// 2027 한울타리 FC 유니폼 후보 17종.
// 출처: 「한울 유니폼 후보 추천.pptx」 (2026-10-09)
//
// family = 디자인 계열. 1라운드는 같은 계열끼리 붙인다 —
// 비슷한 디자인이 표를 나눠 먹고 둘 다 탈락하는 일을 막기 위해서다.
// 추천인(누가 올린 후보인지)은 공개 저장소에 올리지 않는다 — 원본 pptx에 남아 있다.
// 투표 화면에도 띄우지 않는다. 디자인이 아니라 사람을 보고 고르게 되기 때문이다.

const KITS = [
  { id: 'nebula',        name: 'Nebula FC',        vendor: '라푸리아',      price: 55000, family: '블루 그라데이션',
    url: 'https://lafuria.kr/product/%EC%B6%95%EA%B5%AC%EC%9C%A0%EB%8B%88%ED%8F%BC%EC%A0%9C%EC%9E%91-%EC%83%98%ED%94%8C-3nebula-fcshorts/11/category/62/display/1/' },
  { id: 'solar',         name: 'Solar Infinity',   vendor: '라푸리아',      price: 55000, family: '블루 그라데이션',
    url: 'https://lafuria.kr/product/%EC%B6%95%EA%B5%AC%EC%9C%A0%EB%8B%88%ED%8F%BC%EC%A0%9C%EC%9E%91-%EC%83%98%ED%94%8C-83solar-infinity-short/289/category/62/display/1/' },
  { id: 'aero',          name: 'Aero Arrows',      vendor: '라푸리아',      price: 55000, family: '민트 그라데이션',
    url: 'https://lafuria.kr/product/%EC%B6%95%EA%B5%AC%EC%9C%A0%EB%8B%88%ED%8F%BC%EC%A0%9C%EC%9E%91-%EC%83%98%ED%94%8C-10aero-arrows-shorts/20/category/62/display/1/' },
  { id: 'wave',          name: 'Wave Blue (긴팔)', vendor: '라푸리아',      price: 55000, family: '민트 그라데이션',
    url: 'https://lafuria.kr/product/%EC%B6%95%EA%B5%AC%EC%9C%A0%EB%8B%88%ED%8F%BC%EC%A0%9C%EC%9E%91-%EC%83%98%ED%94%8C-17wave-blue-long/36/category/62/display/1/' },
  { id: 'football',      name: 'Football Club',    vendor: '라푸리아',      price: 55000, family: '블랙 그래픽',
    url: 'https://lafuria.kr/product/%EC%B6%95%EA%B5%AC%EC%9C%A0%EB%8B%88%ED%8F%BC%EC%A0%9C%EC%9E%91-%EC%83%98%ED%94%8C-2footbal-clubshorts/10/category/62/display/1/' },
  { id: 'fantasista',    name: 'Design 070',       vendor: '판타지스타',    price: 38000, family: '블랙 그래픽',
    url: 'https://fantasista.co.kr/32/?idx=340' },
  { id: 'element',       name: 'Element Elites',   vendor: '라푸리아',      price: 55000, family: '화이트',
    url: 'https://lafuria.kr/product/%EC%B6%95%EA%B5%AC%EC%9C%A0%EB%8B%88%ED%8F%BC%EC%A0%9C%EC%9E%91-%EC%83%98%ED%94%8C-81element-elites-short/281/category/62/display/1/' },
  { id: 'kirinco-white', name: '화이트 카라',      vendor: 'KIRINCO 커스텀', price: 35000, family: '화이트', url: '' },
  { id: 'helix',         name: 'Helix Kickers',    vendor: '라푸리아',      price: 55000, family: '스트라이프',
    url: 'https://lafuria.kr/product/%EC%B6%95%EA%B5%AC%EC%9C%A0%EB%8B%88%ED%8F%BC%EC%A0%9C%EC%9E%91-%EC%83%98%ED%94%8C-44helix-kickers-short/119/category/62/display/1/' },
  { id: 'doubleteam',    name: '기능성 카라 블루', vendor: '클래스스포츠',  price: 44000, family: '스트라이프',
    url: 'https://smartstore.naver.com/classfactory/products/13719586635' },
  { id: 'zenith',        name: 'Zenith Infinity',  vendor: '라푸리아',      price: 55000, family: '사선 그래픽',
    url: 'https://lafuria.kr/product/%EC%B6%95%EA%B5%AC%EC%9C%A0%EB%8B%88%ED%8F%BC%EC%A0%9C%EC%9E%91-%EC%83%98%ED%94%8C-56zenith-infinity-short/170/category/62/display/1/' },
  { id: 'kirinco-teal',  name: '청록 사선',        vendor: 'KIRINCO 커스텀', price: 35000, family: '사선 그래픽', url: '' },
  { id: 'legion',        name: 'Legion FC',        vendor: '라푸리아',      price: 55000, family: '딥 네이비·골드',
    url: 'https://lafuria.kr/product/%EC%B6%95%EA%B5%AC%EC%9C%A0%EB%8B%88%ED%8F%BC%EC%A0%9C%EC%9E%91-%EC%83%98%ED%94%8C-95legion-fc-short/341/category/62/display/1/' },
  { id: 'kirinco-black', name: '블랙 골드',        vendor: 'KIRINCO 커스텀', price: 35000, family: '딥 네이비·골드', url: '' },
  { id: 'blueshield',    name: 'Blue Shield',      vendor: '라푸리아',      price: 55000, family: '하늘색 클래식',
    url: 'https://lafuria.kr/product/%EC%B6%95%EA%B5%AC%EC%9C%A0%EB%8B%88%ED%8F%BC%EC%A0%9C%EC%9E%91-%EC%83%98%ED%94%8C-21blue-shield-short/40/category/62/display/1/' },
  { id: 'kirinco-navy',  name: '네이비 카라 브이넥', vendor: 'KIRINCO 커스텀', price: 35000, family: '하늘색 클래식', url: '' },
  { id: 'kirinco-mint',  name: '민트 카라',        vendor: 'KIRINCO 커스텀', price: 35000, family: '하늘색 클래식', url: '' },
];

// 17종이라 2의 거듭제곱이 아니다. 「하늘색 클래식」 계열만 3종이므로
// 그 계열에서 예선 1경기를 치러 16강을 채운다.
const PLAYIN = ['kirinco-navy', 'kirinco-mint'];

// 16강 대진. 'W'는 예선 승자 자리.
const ROUND16 = [
  ['nebula', 'solar'],
  ['aero', 'wave'],
  ['football', 'fantasista'],
  ['element', 'kirinco-white'],
  ['helix', 'doubleteam'],
  ['zenith', 'kirinco-teal'],
  ['legion', 'kirinco-black'],
  ['blueshield', 'W'],
];

// 단계별 진출 점수. 예선은 16강 자리를 채우는 경기라 점수를 주지 않는다 —
// 주면 예선을 거친 디자인만 최대 점수가 높아져 불공평해진다.
const POINTS = { playin: 0, r16: 2, qf: 3, sf: 5, final: 8 };

const ROUND_LABEL = { playin: '예선', r16: '16강', qf: '8강', sf: '4강', final: '결승' };

module.exports = { KITS, PLAYIN, ROUND16, POINTS, ROUND_LABEL };
