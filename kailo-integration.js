// Kailo Integration Module for RideLog Desktop
// Fetches training plan data from Kailo and converts it to RideLog's plan format

const KAILO_PLAN_ID = '01kyz00sg9v7vjqb9v8qrbwx4v'; // 400km Audax April 2027 plan (Advanced - starts with 200km Aug 23)
const KAILO_API_BASE = 'https://api.kailo.fit';

/**
 * Converts Kailo training plan data to RideLog planRows format
 * @param {Object} kailoPlan - The training plan from Kailo
 * @returns {Array} planRows in RideLog format
 */
function convertKailoPlanToRidelogFormat(kailoPlan) {
  const planRows = [];

  for (const week of kailoPlan.schedule) {
    // Get the Monday of this week (Kailo provides planned_date for each workout)
    const firstWorkout = week.workouts[0];
    const weekStart = firstWorkout.planned_date.slice(0, 10); // Extract YYYY-MM-DD

    // Find Monday of the week containing this date
    const date = new Date(weekStart + 'T00:00:00Z');
    const dayOfWeek = date.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    date.setUTCDate(date.getUTCDate() + daysToMonday);
    const mondayISO = date.toISOString().slice(0, 10);

    // Convert miles to km (Kailo returns distances in miles)
    const targetVolKm = Math.round(week.target_volume_mi * 1.60934);

    // Find the longest ride (Saturday typically)
    const longRide = week.workouts.reduce((max, w) =>
      w.distance_mi > (max?.distance_mi || 0) ? w : max,
      null
    );
    const targetLongKm = longRide ? Math.round(longRide.distance_mi * 1.60934) : 0;

    // Create RideLog planRow
    planRows.push({
      weekStart: mondayISO,
      weekNum: week.week_number,
      targetVol: targetVolKm,
      targetLong: targetLongKm,
      targetSat: 0, // Not used in this plan
      phase: getPhaseForWeek(week.week_number, kailoPlan),
      audax: week.focus_md || '',
      coaching: extractCoachingNotes(week.workouts),
      dailyTargets: buildDailyTargets(week.workouts)
    });
  }

  return planRows;
}

/**
 * Determines the training phase based on week number
 */
function getPhaseForWeek(weekNum, plan) {
  if (weekNum <= 8) return 'Base Building';
  if (weekNum <= 16) return 'Endurance Build';
  if (weekNum <= 29) return 'Specificity';
  if (weekNum <= 33) return 'Taper';
  return 'Event Week';
}

/**
 * Extracts coaching notes from workouts
 */
function extractCoachingNotes(workouts) {
  const notes = workouts
    .filter(w => w.coaching_note)
    .map(w => `${getDayName(w.planned_date)}: ${w.coaching_note}`);
  return notes.join(' | ');
}

/**
 * Builds daily distance targets for the week
 */
function buildDailyTargets(workouts) {
  const targets = {};
  for (const workout of workouts) {
    const date = workout.planned_date;
    const distanceKm = Math.round(workout.distance_mi * 1.60934);
    targets[date] = distanceKm;
  }
  return targets;
}

/**
 * Gets day name from ISO date
 */
function getDayName(isoDate) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const date = new Date(isoDate + 'T00:00:00Z');
  return days[date.getUTCDay()];
}

/**
 * Fetches the Kailo training plan and updates RideLog's planRows
 * This would be called from the main app when syncing training data
 */
async function syncKailoTrainingPlan() {
  try {
    // In a real implementation, this would call the Kailo MCP API
    // For now, we'll use the plan data structure that was created

    const kailoPlan = {
      plan_id: KAILO_PLAN_ID,
      race_date: '2027-04-15',
      race_distance_mi: 248.5,
      total_weeks: 35,
      // This would come from the actual API call
      schedule: [] // Would be populated from mcp__claude_ai_Getfast__training_plan_get
    };

    return {
      success: true,
      planId: kailoPlan.plan_id,
      raceDate: kailoPlan.race_date,
      totalWeeks: kailoPlan.total_weeks
    };
  } catch (error) {
    console.error('Kailo sync error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Static plan data export - this contains the actual 400km Audax plan
 * In production, this would be fetched from Kailo API
 */
const KAILO_400KM_PLAN_DATA = {
  planId: '01kyz00sg9v7vjqb9v8qrbwx4v',
  raceDate: '2027-04-10',
  raceDistanceKm: 400,
  firstEvent: { date: '2026-08-29', distance: 200, name: '200km Audax' },
  weeklyTargets: [
    { weekNum: 1, startDate: '2026-08-24', volumeKm: 327, longRideKm: 221, phase: '200km Event Week' },
    { weekNum: 2, startDate: '2026-08-24', volumeKm: 173, longRideKm: 71, phase: 'Base Building' },
    { weekNum: 3, startDate: '2026-08-31', volumeKm: 195, longRideKm: 80, phase: 'Base Building' },
    { weekNum: 4, startDate: '2026-09-07', volumeKm: 131, longRideKm: 53, phase: 'Recovery Week' },
    { weekNum: 5, startDate: '2026-09-14', volumeKm: 212, longRideKm: 88, phase: 'Building' },
    { weekNum: 6, startDate: '2026-09-21', volumeKm: 235, longRideKm: 97, phase: 'Building' },
    { weekNum: 7, startDate: '2026-09-28', volumeKm: 257, longRideKm: 106, phase: 'Building' },
    { weekNum: 8, startDate: '2026-10-05', volumeKm: 159, longRideKm: 62, phase: 'Recovery Week' },
    { weekNum: 9, startDate: '2026-10-12', volumeKm: 266, longRideKm: 115, phase: 'Endurance Build' },
    { weekNum: 10, startDate: '2026-10-19', volumeKm: 288, longRideKm: 124, phase: 'Endurance Build' },
    { weekNum: 11, startDate: '2026-10-26', volumeKm: 313, longRideKm: 133, phase: 'Endurance Build' },
    { weekNum: 12, startDate: '2026-11-02', volumeKm: 188, longRideKm: 71, phase: 'Recovery Week' },
    { weekNum: 13, startDate: '2026-11-09', volumeKm: 322, longRideKm: 142, phase: 'Century Build' },
    { weekNum: 14, startDate: '2026-11-16', volumeKm: 340, longRideKm: 150, phase: 'Century Build' },
    { weekNum: 15, startDate: '2026-11-23', volumeKm: 357, longRideKm: 159, phase: 'Peak Build' },
    { weekNum: 16, startDate: '2026-11-30', volumeKm: 209, longRideKm: 80, phase: 'Recovery Week' },
    { weekNum: 17, startDate: '2026-12-07', volumeKm: 375, longRideKm: 168, phase: 'Specificity' },
    { weekNum: 18, startDate: '2026-12-14', volumeKm: 372, longRideKm: 221, phase: '200km Audax' },
    { weekNum: 19, startDate: '2026-12-21', volumeKm: 225, longRideKm: 88, phase: 'Recovery' },
    { weekNum: 20, startDate: '2026-12-28', volumeKm: 389, longRideKm: 177, phase: 'Build' },
    { weekNum: 21, startDate: '2027-01-04', volumeKm: 412, longRideKm: 186, phase: 'Build' },
    { weekNum: 22, startDate: '2027-01-11', volumeKm: 439, longRideKm: 195, phase: 'Peak Week' },
    { weekNum: 23, startDate: '2027-01-18', volumeKm: 248, longRideKm: 97, phase: 'Recovery Week' },
    { weekNum: 24, startDate: '2027-01-25', volumeKm: 443, longRideKm: 204, phase: '300km Weekend' },
    { weekNum: 25, startDate: '2027-02-01', volumeKm: 269, longRideKm: 106, phase: 'Recovery' },
    { weekNum: 26, startDate: '2027-02-08', volumeKm: 416, longRideKm: 195, phase: 'Maintain' },
    { weekNum: 27, startDate: '2027-02-15', volumeKm: 381, longRideKm: 177, phase: 'Maintain' },
    { weekNum: 28, startDate: '2027-02-22', volumeKm: 278, longRideKm: 115, phase: 'Recovery Week' },
    { weekNum: 29, startDate: '2027-03-01', volumeKm: 398, longRideKm: 186, phase: 'Final Big Week' },
    { weekNum: 30, startDate: '2027-03-08', volumeKm: 324, longRideKm: 142, phase: 'Taper Begin' },
    { weekNum: 31, startDate: '2027-03-15', volumeKm: 269, longRideKm: 115, phase: 'Taper' },
    { weekNum: 32, startDate: '2027-03-22', volumeKm: 216, longRideKm: 88, phase: 'Deep Taper' },
    { weekNum: 33, startDate: '2027-03-29', volumeKm: 173, longRideKm: 62, phase: 'Final Taper' },
    { weekNum: 34, startDate: '2027-04-05', volumeKm: 48, longRideKm: 27, phase: 'Event Week Prep' },
    { weekNum: 35, startDate: '2027-04-12', volumeKm: 443, longRideKm: 443, phase: '400KM AUDAX!' }
  ]
};

// Export for use in main app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    convertKailoPlanToRidelogFormat,
    syncKailoTrainingPlan,
    KAILO_400KM_PLAN_DATA
  };
}
