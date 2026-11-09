'use strict';

const settings = {
  battery_start_bdt: 500,
  pricing_is_sample: true,
  outside_keywords: "chattogram,chittagong,sylhet,khulna,rajshahi,barishal,barisal,rangpur,mymensingh,cumilla,comilla,cox's bazar,coxs bazar,bogura,jessore,jashore,চট্টগ্রাম,সিলেট,খুলনা,রাজশাহী,বরিশাল,রংপুর,ময়মনসিংহ,কুমিল্লা,কক্সবাজার,কক্স বাজার,বগুড়া,যশোর",
};

const areas = [
  ['dhaka', 'Dhaka', 'ঢাকা', 'dacca,mohakhali,khilgaon,panthapath,kawran bazar,niketan,malibagh,shantinagar,wari,demra,sabujbagh,cantonment,airport,khilkhet,azimpur,hazaribagh,gulistan,kakrail,segunbagicha,eskaton,moghbazar,tongi bridge,মহাখালী,খিলগাঁও,পান্থপথ'],
  ['mirpur', 'Mirpur', 'মিরপুর', 'pallabi,kafrul,pallabi metro,পল্লবী,কাফরুল'],
  ['uttara', 'Uttara', 'উত্তরা', 'sector 7,diabari,দিয়াবাড়ি'],
  ['dhanmondi', 'Dhanmondi', 'ধানমন্ডি', 'kalabagan,shankar,কলাবাগান,শংকর'],
  ['gulshan', 'Gulshan', 'গুলশান', 'banani,baridhara,বনানী,বারিধারা'],
  ['mohammadpur', 'Mohammadpur', 'মোহাম্মদপুর', 'adabor,shyamoli,আদাবর,শ্যামলী'],
  ['badda', 'Badda', 'বাড্ডা', 'rampura,basundhara,bashundhara,রামপুরা,বসুন্ধরা'],
  ['motijheel', 'Motijheel', 'মতিঝিল', 'paltan,shahbag,shahbagh,পল্টন,শাহবাগ'],
  ['tejgaon', 'Tejgaon', 'তেজগাঁও', 'farmgate,karwan bazar,ফার্মগেট,কারওয়ান বাজার'],
  ['old-dhaka', 'Old Dhaka', 'পুরান ঢাকা', 'lalbagh,jatrabari,লালবাগ,যাত্রাবাড়ী'],
].map(([_id, name_en, name_bn, keywords]) => ({ _id, name_en, name_bn, keywords, active: true }));

const samplePricing = [
  ['tyre', 'Tyre change or repair labour', 'টায়ার পরিবর্তন বা মেরামতের মজুরি', 300, 800],
  ['brakes', 'Brake inspection and pad service', 'ব্রেক পরিদর্শন ও প্যাড সার্ভিস', 800, 4000],
  ['overheating', 'Cooling system check', 'কুলিং সিস্টেম পরীক্ষা', 600, 3500],
  ['electrical', 'Electrical or fuse diagnosis', 'বৈদ্যুতিক বা ফিউজ পরীক্ষা', 500, 3000],
  ['ac', 'AC check', 'এসি পরীক্ষা', 800, 3500],
].map(([category, label_en, label_bn, min_bdt, max_bdt]) => ({
  _id: `sample_${category}`, category, label_en, label_bn, min_bdt, max_bdt,
  note_en: 'Sample data', note_bn: 'নমুনা ডেটা', active: true, sample: true,
}));

module.exports = { settings, areas, samplePricing };
