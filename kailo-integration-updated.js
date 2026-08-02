// Kailo Integration Module for RideLog Desktop - UPDATED PLAN
// Your customized 400km Audax training plan starting with 200km event on August 23, 2026

const KAILO_PLAN_ID = '01kyz00sg9v7vjqb9v8qrbwx4v';
const KAILO_API_BASE = 'https://api.kailo.fit';

/**
 * Updated 400km Audax Plan - Advanced Start
 * Accounts for your current 100-mile fitness and 200km event on August 23
 */
const KAILO_400KM_PLAN_DATA = {
  planId: '01kyz00sg9v7vjqb9v8qrbwx4v',
  raceDate: '2027-04-10',
  raceDistanceKm: 400,
  startingFitness: '100 miles (160km)',
  firstEvent: { date: '2026-08-29', distance: 200, name: '200km Audax Certification' },
  totalWeeks: 34,
  totalDistanceKm: 12542,
  peakWeeklyKm: 550,

  weeklyTargets: [
    // Week 1: Taper for 200km event - August 23rd
    { weekNum: 1, startDate: '2026-08-24', volumeKm: 327, longRideKm: 221, phase: '200km Event Week' },

    // Week 2: Recovery from 200km
    { weekNum: 2, startDate: '2026-08-31', volumeKm: 186, longRideKm: 71, phase: 'Recovery' },

    // Weeks 3-4: Return to volume
    { weekNum: 3, startDate: '2026-09-07', volumeKm: 310, longRideKm: 124, phase: 'Build' },
    { weekNum: 4, startDate: '2026-09-14', volumeKm: 345, longRideKm: 142, phase: 'Build' },

    // Week 5: Recovery
    { weekNum: 5, startDate: '2026-09-21', volumeKm: 230, longRideKm: 88, phase: 'Recovery Week' },

    // Weeks 6-8: 100-mile+ weekend rides
    { weekNum: 6, startDate: '2026-09-28', volumeKm: 381, longRideKm: 159, phase: 'Century Build' },
    { weekNum: 7, startDate: '2026-10-05', volumeKm: 421, longRideKm: 186, phase: 'First 100+mi Saturday' },
    { weekNum: 8, startDate: '2026-10-12', volumeKm: 446, longRideKm: 195, phase: 'Progressive Build' },

    // Week 9: Recovery
    { weekNum: 9, startDate: '2026-10-19', volumeKm: 265, longRideKm: 106, phase: 'Recovery Week' },

    // Weeks 10-12: 120-mile progression
    { weekNum: 10, startDate: '2026-10-26', volumeKm: 458, longRideKm: 204, phase: 'Build to 120mi' },
    { weekNum: 11, startDate: '2026-11-02', volumeKm: 481, longRideKm: 212, phase: '120mi Saturday - Ultra Territory' },
    { weekNum: 12, startDate: '2026-11-09', volumeKm: 504, longRideKm: 221, phase: 'Peak Volume - 200km Solo' },

    // Week 13: Recovery
    { weekNum: 13, startDate: '2026-11-16', volumeKm: 292, longRideKm: 115, phase: 'Recovery Week' },

    // Week 14: Longest single ride
    { weekNum: 14, startDate: '2026-11-23', volumeKm: 517, longRideKm: 230, phase: '130mi Ride - 210km Peak' },

    // Weeks 15-16: Maintain ultra volume
    { weekNum: 15, startDate: '2026-11-30', volumeKm: 504, longRideKm: 221, phase: 'Maintain Ultra Volume' },
    { weekNum: 16, startDate: '2026-12-07', volumeKm: 513, longRideKm: 221, phase: 'Optional 300km Audax' },

    // Week 17: Recovery
    { weekNum: 17, startDate: '2026-12-14', volumeKm: 310, longRideKm: 124, phase: 'Recovery Week' },

    // Week 18: First 300km weekend
    { weekNum: 18, startDate: '2026-12-21', volumeKm: 517, longRideKm: 230, phase: '300km Weekend Milestone' },

    // Week 19: Recovery from 300km
    { weekNum: 19, startDate: '2026-12-28', volumeKm: 313, longRideKm: 124, phase: 'Recovery from 300km' },

    // Weeks 20-21: Peak volume phase
    { weekNum: 20, startDate: '2027-01-04', volumeKm: 504, longRideKm: 221, phase: 'High Volume' },
    { weekNum: 21, startDate: '2027-01-11', volumeKm: 550, longRideKm: 239, phase: 'PEAK WEEK - 217km Long Ride' },

    // Week 22: Maintain
    { weekNum: 22, startDate: '2027-01-18', volumeKm: 504, longRideKm: 221, phase: 'Maintain Ultra Fitness' },

    // Week 23: Recovery
    { weekNum: 23, startDate: '2027-01-25', volumeKm: 336, longRideKm: 133, phase: 'Recovery Week' },

    // Weeks 24-25: Final big weeks
    { weekNum: 24, startDate: '2027-02-01', volumeKm: 508, longRideKm: 221, phase: 'Second 300km Weekend' },
    { weekNum: 25, startDate: '2027-02-08', volumeKm: 487, longRideKm: 212, phase: 'Final High Volume' },

    // Week 26: Recovery before taper
    { weekNum: 26, startDate: '2027-02-15', volumeKm: 310, longRideKm: 124, phase: 'Enter Taper Phase' },

    // Weeks 27-30: Taper
    { weekNum: 27, startDate: '2027-02-22', volumeKm: 407, longRideKm: 177, phase: 'Taper Begins' },
    { weekNum: 28, startDate: '2027-03-01', volumeKm: 354, longRideKm: 150, phase: 'Continue Taper' },
    { weekNum: 29, startDate: '2027-03-08', volumeKm: 301, longRideKm: 124, phase: 'Deep Taper' },
    { weekNum: 30, startDate: '2027-03-15', volumeKm: 242, longRideKm: 97, phase: 'Final Taper' },

    // Weeks 31-32: Event prep
    { weekNum: 31, startDate: '2027-03-22', volumeKm: 88, longRideKm: 35, phase: 'Pre-Event Week' },
    { weekNum: 32, startDate: '2027-03-29', volumeKm: 48, longRideKm: 27, phase: 'Event Week Prep' },

    // Week 33: EVENT!
    { weekNum: 33, startDate: '2027-04-05', volumeKm: 456, longRideKm: 443, phase: '🎯 400KM AUDAX EVENT!' },

    // Week 34: Recovery
    { weekNum: 34, startDate: '2027-04-12', volumeKm: 124, longRideKm: 44, phase: 'Post-Event Recovery' }
  ]
};

/**
 * Key milestones in your training plan
 */
const PLAN_MILESTONES = [
  { week: 1, date: '2026-08-29', event: '200km Audax Certification', distance: 221 },
  { week: 7, date: '2026-10-10', event: 'First 100+ mile Saturday', distance: 186 },
  { week: 11, date: '2026-11-07', event: '120-mile ride - Ultra territory', distance: 212 },
  { week: 12, date: '2026-11-14', event: '200km solo ride - Self-sufficiency test', distance: 221 },
  { week: 14, date: '2026-11-28', event: 'Longest training ride (210km)', distance: 230 },
  { week: 18, date: '2026-12-26', event: 'First 300km weekend', distance: 230 },
  { week: 21, date: '2027-01-16', event: 'Peak volume - 217km long ride', distance: 239 },
  { week: 24, date: '2027-02-06', event: 'Second 300km weekend - Confidence builder', distance: 221 },
  { week: 33, date: '2027-04-10', event: '🎯 400KM AUDAX EVENT!', distance: 443 }
];

/**
 * Training zones and pacing guidance
 */
const TRAINING_ZONES = {
  recovery: 'Very easy - conversational pace, keep HR low',
  easy: 'Comfortable - sustainable for hours, Zone 2',
  zone2: 'Aerobic base - 120-150 bpm, can talk in sentences',
  tempo: 'Comfortably hard - sustained effort, 150-165 bpm',
  threshold: 'Hard but sustainable - 165-175 bpm, minimal talking',
  audaxPace: 'Conservative - aim for 18-20 km/h average, sustainable for 20+ hours'
};

/**
 * Nutrition guidelines for long rides
 */
const NUTRITION_GUIDE = {
  under90min: 'Water only, no fuel needed',
  '90min-3hrs': '30-45g carbs/hour, 500ml water/hour',
  '3hrs-6hrs': '60-75g carbs/hour, 600-750ml water/hour + electrolytes',
  over6hrs: '60-90g carbs/hour, 750ml water/hour, sodium 500-1000mg/hour, mix solid/liquid fuel',
  audaxEvent: 'Fuel every 30-45 min religiously, don\'t wait until hungry. Control stops every 50-70km.'
};

// Export for use in main app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    KAILO_400KM_PLAN_DATA,
    PLAN_MILESTONES,
    TRAINING_ZONES,
    NUTRITION_GUIDE
  };
}
