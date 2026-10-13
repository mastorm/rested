use chrono::{DateTime, Duration, Local, TimeZone};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Study,
    Play,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Notice {
    BudgetEmpty,
    SleepPaused,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayTotals {
    pub date: String,
    pub study_ms: u64,
    pub play_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: u64,
    pub mode: Mode,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub day_totals: Option<BTreeMap<String, DayTotals>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInput {
    pub mode: Mode,
    pub started_at: i64,
    pub duration_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedData {
    pub version: u32,
    pub study_ms: u64,
    pub play_ms: u64,
    pub days: BTreeMap<String, DayTotals>,
    pub sessions: Vec<Session>,
    pub next_id: u64,
    pub notifications_enabled: bool,
}

impl Default for SavedData {
    fn default() -> Self {
        Self {
            version: 1,
            study_ms: 0,
            play_ms: 0,
            days: BTreeMap::new(),
            sessions: Vec::new(),
            next_id: 1,
            notifications_enabled: true,
        }
    }
}

impl SavedData {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("This saved data uses an unsupported version of Rested.".into());
        }
        if self.play_ms > self.study_ms.saturating_mul(2) {
            return Err("Saved playtime exceeds the earned reserve.".into());
        }
        let study: u128 = self.days.values().map(|d| u128::from(d.study_ms)).sum();
        let play: u128 = self.days.values().map(|d| u128::from(d.play_ms)).sum();
        if study != u128::from(self.study_ms) || play != u128::from(self.play_ms) {
            return Err("Saved daily totals do not match the time ledger.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub mode: Option<Mode>,
    pub balance_ms: u64,
    pub today: DayTotals,
    pub study_ms: u64,
    pub play_ms: u64,
    pub current_session_ms: u64,
    pub active_session_id: Option<u64>,
    pub session_count: usize,
    pub sessions: Vec<Session>,
    pub week: Vec<DayTotals>,
    pub notice: Option<Notice>,
    pub notifications_enabled: bool,
    pub storage_error: Option<String>,
}

#[derive(Clone)]
pub struct Engine {
    pub data: SavedData,
    pub mode: Option<Mode>,
    pub notice: Option<Notice>,
    pub revision: u64,
    pub active_session_id: Option<u64>,
}

impl Engine {
    pub fn new(data: SavedData) -> Self {
        // Active sessions are never restored: no credit is earned while the app is closed.
        Self {
            data,
            mode: None,
            notice: None,
            revision: 0,
            active_session_id: None,
        }
    }

    pub fn balance(&self) -> u64 {
        self.data
            .study_ms
            .saturating_mul(2)
            .saturating_sub(self.data.play_ms)
    }

    pub fn start(&mut self, mode: Mode, now: DateTime<Local>) -> Result<(), String> {
        if self.mode == Some(mode) {
            return Ok(());
        }
        if mode == Mode::Play && self.balance() == 0 {
            return Err("Your reserve is empty. Study to earn some playtime first.".into());
        }
        self.data.sessions.push(Session {
            id: self.data.next_id,
            mode,
            started_at: now.timestamp_millis(),
            ended_at: now.timestamp_millis(),
            duration_ms: 0,
            day_totals: Some(BTreeMap::new()),
        });
        self.active_session_id = Some(self.data.next_id);
        self.data.next_id += 1;
        if self.data.sessions.len() > 1000 {
            self.data.sessions.remove(0);
        }
        self.mode = Some(mode);
        self.notice = None;
        self.revision += 1;
        Ok(())
    }

    pub fn pause(&mut self) {
        if self.mode.take().is_some() {
            self.active_session_id = None;
            self.revision += 1;
        }
    }

    pub fn pause_for_sleep(&mut self) {
        if self.mode.is_some() {
            self.pause();
            self.notice = Some(Notice::SleepPaused);
        }
    }

    /// Apply a trusted, monotonic elapsed interval. Playing is clamped at the exact reserve.
    /// Returns true only on the transition to an empty reserve (one notification per session).
    pub fn advance(&mut self, elapsed_ms: u64, now: DateTime<Local>) -> bool {
        let Some(mode) = self.mode else { return false };
        if elapsed_ms == 0 {
            return false;
        }
        let applied = match mode {
            Mode::Study => elapsed_ms,
            Mode::Play => elapsed_ms.min(self.balance()),
        };
        let start = now - Duration::milliseconds(elapsed_ms as i64);
        match mode {
            Mode::Study => self.data.study_ms += applied,
            Mode::Play => self.data.play_ms += applied,
        }
        let contributions = Self::interval_days(mode, start, applied);
        Self::apply_days(&mut self.data.days, &contributions, false)
            .expect("Time credit cannot underflow");
        if let Some(session) = self
            .data
            .sessions
            .iter_mut()
            .find(|s| Some(s.id) == self.active_session_id)
        {
            session.duration_ms += applied;
            session.ended_at = (start + Duration::milliseconds(applied as i64)).timestamp_millis();
            if let Some(days) = &mut session.day_totals {
                Self::apply_days(days, &contributions, false)
                    .expect("Session credit cannot underflow");
            }
        }
        self.revision += 1;
        if mode == Mode::Play && self.balance() == 0 {
            self.mode = None;
            self.active_session_id = None;
            self.notice = Some(Notice::BudgetEmpty);
            return true;
        }
        false
    }

    fn interval_days(
        mode: Mode,
        mut start: DateTime<Local>,
        mut remaining: u64,
    ) -> BTreeMap<String, DayTotals> {
        let mut days = BTreeMap::new();
        while remaining > 0 {
            // Split at local midnight, accounting for DST instead of assuming 24-hour days.
            let next_midnight = start
                .date_naive()
                .succ_opt()
                .and_then(|date| date.and_hms_opt(0, 0, 0))
                .and_then(|date| Local.from_local_datetime(&date).earliest());
            let until_midnight = next_midnight
                .map(|end| (end - start).num_milliseconds().max(1) as u64)
                .unwrap_or(remaining);
            let amount = remaining.min(until_midnight);
            let date = start.format("%Y-%m-%d").to_string();
            let day = days.entry(date.clone()).or_insert_with(|| DayTotals {
                date,
                ..Default::default()
            });
            match mode {
                Mode::Study => day.study_ms += amount,
                Mode::Play => day.play_ms += amount,
            }
            remaining -= amount;
            start += Duration::milliseconds(amount as i64);
        }
        days
    }

    fn apply_days(
        days: &mut BTreeMap<String, DayTotals>,
        contributions: &BTreeMap<String, DayTotals>,
        subtract: bool,
    ) -> Result<(), String> {
        for (date, amount) in contributions {
            let day = days.entry(date.clone()).or_insert_with(|| DayTotals {
                date: date.clone(),
                ..Default::default()
            });
            if subtract {
                day.study_ms = day
                    .study_ms
                    .checked_sub(amount.study_ms)
                    .ok_or("Cannot safely reconcile this session with its daily totals.")?;
                day.play_ms = day
                    .play_ms
                    .checked_sub(amount.play_ms)
                    .ok_or("Cannot safely reconcile this session with its daily totals.")?;
            } else {
                day.study_ms += amount.study_ms;
                day.play_ms += amount.play_ms;
            }
        }
        Ok(())
    }

    // Older ledgers have no per-session day allocation. Match their recorded interval
    // against available historical totals, preserving archived time and exact new entries.
    fn session_days(
        data: &SavedData,
        session: &Session,
    ) -> Result<BTreeMap<String, DayTotals>, String> {
        if let Some(days) = &session.day_totals {
            return Ok(days.clone());
        }
        let start = DateTime::from_timestamp_millis(session.started_at)
            .ok_or("Invalid session date.")?
            .with_timezone(&Local);
        let time_for = |day: &DayTotals| match session.mode {
            Mode::Study => day.study_ms,
            Mode::Play => day.play_ms,
        };
        let mut available: BTreeMap<String, u64> = data
            .days
            .iter()
            .map(|(date, day)| (date.clone(), time_for(day)))
            .collect();
        for other in &data.sessions {
            if other.id == session.id {
                continue;
            }
            if let Some(days) = &other.day_totals {
                for (date, day) in days {
                    let capacity = available.entry(date.clone()).or_default();
                    *capacity = capacity.saturating_sub(time_for(day));
                }
            }
        }
        let mut result = BTreeMap::new();
        let mut remaining = session.duration_ms;
        let mut allocate =
            |date: &String, requested: u64, available: &mut BTreeMap<String, u64>| {
                let capacity = available.entry(date.clone()).or_default();
                let amount = requested.min(*capacity).min(remaining);
                *capacity -= amount;
                remaining -= amount;
                let day = result.entry(date.clone()).or_insert_with(|| DayTotals {
                    date: date.clone(),
                    ..Default::default()
                });
                match session.mode {
                    Mode::Study => day.study_ms += amount,
                    Mode::Play => day.play_ms += amount,
                }
            };
        for (date, day) in Self::interval_days(session.mode, start, session.duration_ms) {
            allocate(&date, time_for(&day), &mut available);
        }
        let mut dates: Vec<_> = available.keys().cloned().collect();
        dates.sort_by_key(|date| {
            chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
                .map(|day| (day - start.date_naive()).num_days().abs())
                .unwrap_or(i64::MAX)
        });
        for date in dates {
            allocate(&date, u64::MAX, &mut available);
        }
        if remaining > 0 {
            return Err("Cannot safely reconcile this older session with the saved ledger.".into());
        }
        Ok(result)
    }

    fn remove_credit(data: &mut SavedData, session: &Session) -> Result<(), String> {
        let contributions = Self::session_days(data, session)?;
        Self::apply_days(&mut data.days, &contributions, true)?;
        let total = match session.mode {
            Mode::Study => &mut data.study_ms,
            Mode::Play => &mut data.play_ms,
        };
        *total = total
            .checked_sub(session.duration_ms)
            .ok_or("Session duration exceeds the saved total.")?;
        Ok(())
    }

    fn finish_correction(&mut self, data: SavedData) -> Result<bool, String> {
        if data.play_ms > data.study_ms.saturating_mul(2) {
            return Err("This correction would leave more playtime recorded than earned. Add study time or reduce play entries first.".into());
        }
        data.validate()?;
        self.data = data;
        self.revision += 1;
        let empty = self.mode == Some(Mode::Play) && self.balance() == 0;
        if empty {
            self.pause();
            self.notice = Some(Notice::BudgetEmpty);
        } else if self.balance() > 0 && self.notice == Some(Notice::BudgetEmpty) {
            self.notice = None;
        }
        Ok(empty)
    }

    pub fn save_session(
        &mut self,
        id: Option<u64>,
        input: SessionInput,
        now: DateTime<Local>,
    ) -> Result<bool, String> {
        if id.is_some() && id == self.active_session_id {
            return Err("Pause this session before editing it.".into());
        }
        if input.duration_ms == 0 || input.duration_ms > 366 * 24 * 60 * 60 * 1000 {
            return Err("Enter a duration greater than zero and no longer than one year.".into());
        }
        let start = DateTime::from_timestamp_millis(input.started_at)
            .ok_or("Enter a valid start date.")?
            .with_timezone(&Local);
        let end = start
            .checked_add_signed(Duration::milliseconds(input.duration_ms as i64))
            .ok_or("Invalid session duration.")?;
        if end > now {
            return Err(
                "A manual session must finish in the past. Check its start time and duration."
                    .into(),
            );
        }
        let mut data = self.data.clone();
        let position = if let Some(id) = id {
            let position = data
                .sessions
                .iter()
                .position(|s| s.id == id)
                .ok_or("This session no longer exists.")?;
            Self::remove_credit(&mut data, &self.data.sessions[position])?;
            Some(position)
        } else {
            None
        };
        let contributions = Self::interval_days(input.mode, start, input.duration_ms);
        Self::apply_days(&mut data.days, &contributions, false)?;
        match input.mode {
            Mode::Study => data.study_ms += input.duration_ms,
            Mode::Play => data.play_ms += input.duration_ms,
        }
        let session = Session {
            id: id.unwrap_or(data.next_id),
            mode: input.mode,
            started_at: input.started_at,
            ended_at: end.timestamp_millis(),
            duration_ms: input.duration_ms,
            day_totals: Some(contributions),
        };
        if let Some(position) = position {
            data.sessions[position] = session;
        } else {
            data.sessions.push(session);
            data.next_id += 1;
            if data.sessions.len() > 1000 {
                if let Some(position) = data
                    .sessions
                    .iter()
                    .position(|s| Some(s.id) != self.active_session_id)
                {
                    data.sessions.remove(position);
                }
            }
        }
        self.finish_correction(data)
    }

    pub fn delete_session(&mut self, id: u64) -> Result<bool, String> {
        if self.active_session_id == Some(id) {
            return Err("Pause this session before deleting it.".into());
        }
        let mut data = self.data.clone();
        let position = data
            .sessions
            .iter()
            .position(|s| s.id == id)
            .ok_or("This session no longer exists.")?;
        Self::remove_credit(&mut data, &self.data.sessions[position])?;
        data.sessions.remove(position);
        self.finish_correction(data)
    }

    pub fn list_sessions(&self) -> Vec<Session> {
        let mut sessions = self.data.sessions.clone();
        sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at).then(b.id.cmp(&a.id)));
        sessions
    }

    pub fn snapshot(&self, now: DateTime<Local>, storage_error: Option<String>) -> Snapshot {
        let day_for = |date: String| {
            self.data.days.get(&date).cloned().unwrap_or(DayTotals {
                date,
                ..Default::default()
            })
        };
        let today = day_for(now.format("%Y-%m-%d").to_string());
        let week = (0..7)
            .rev()
            .map(|offset| {
                day_for(
                    (now.date_naive() - Duration::days(offset))
                        .format("%Y-%m-%d")
                        .to_string(),
                )
            })
            .collect();
        Snapshot {
            revision: self.revision,
            mode: self.mode,
            balance_ms: self.balance(),
            today,
            study_ms: self.data.study_ms,
            play_ms: self.data.play_ms,
            current_session_ms: if self.mode.is_some() {
                self.data
                    .sessions
                    .iter()
                    .find(|s| Some(s.id) == self.active_session_id)
                    .map(|s| s.duration_ms)
                    .unwrap_or(0)
            } else {
                0
            },
            active_session_id: self.active_session_id,
            session_count: self.data.sessions.len(),
            sessions: self
                .list_sessions()
                .into_iter()
                .filter(|s| s.duration_ms > 0)
                .take(6)
                .collect(),
            week,
            notice: self.notice,
            notifications_enabled: self.data.notifications_enabled,
            storage_error,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 10, 13, 12, 0, 0).unwrap()
    }

    #[test]
    fn one_minute_of_study_earns_two_minutes_of_play() {
        let mut engine = Engine::new(SavedData::default());
        engine.start(Mode::Study, now()).unwrap();
        engine.advance(60_000, now() + Duration::minutes(1));
        assert_eq!(engine.balance(), 120_000);
        assert_eq!(engine.data.study_ms, 60_000);
        engine.data.validate().unwrap();
    }

    #[test]
    fn switching_modes_never_counts_both_timers() {
        let mut engine = Engine::new(SavedData::default());
        engine.start(Mode::Study, now()).unwrap();
        engine.advance(60_000, now() + Duration::minutes(1));
        engine
            .start(Mode::Play, now() + Duration::minutes(1))
            .unwrap();
        engine.advance(30_000, now() + Duration::seconds(90));
        assert_eq!(engine.data.study_ms, 60_000);
        assert_eq!(engine.data.play_ms, 30_000);
        assert_eq!(engine.balance(), 90_000);
        assert_eq!(engine.data.sessions.len(), 2);
    }

    #[test]
    fn empty_reserve_stops_exactly_at_zero_with_one_event() {
        let mut engine = Engine::new(SavedData::default());
        engine.start(Mode::Study, now()).unwrap();
        engine.advance(550, now() + Duration::milliseconds(550));
        engine
            .start(Mode::Play, now() + Duration::milliseconds(550))
            .unwrap();
        assert!(engine.advance(3000, now() + Duration::milliseconds(3550)));
        assert_eq!(engine.data.play_ms, 1100);
        assert_eq!(engine.balance(), 0);
        assert_eq!(engine.mode, None);
        assert_eq!(engine.notice, Some(Notice::BudgetEmpty));
        assert!(!engine.advance(1000, now() + Duration::milliseconds(4550)));
        assert!(engine.start(Mode::Play, now()).is_err());
        engine.data.validate().unwrap();
    }

    #[test]
    fn paused_and_reopened_timers_do_not_earn_time() {
        let mut engine = Engine::new(SavedData::default());
        engine.start(Mode::Study, now()).unwrap();
        engine.advance(5000, now() + Duration::seconds(5));
        engine.pause();
        engine.advance(50_000, now() + Duration::seconds(55));
        let mut restored = Engine::new(engine.data.clone());
        restored.advance(500_000, now() + Duration::seconds(555));
        assert_eq!(restored.mode, None);
        assert_eq!(restored.balance(), 10_000);
    }

    #[test]
    fn sleep_pauses_without_earning_or_spending() {
        let mut engine = Engine::new(SavedData::default());
        engine.start(Mode::Study, now()).unwrap();
        engine.advance(1000, now() + Duration::seconds(1));
        engine.pause_for_sleep();
        engine.advance(3_600_000, now() + Duration::hours(1));
        assert_eq!(engine.balance(), 2000);
        assert_eq!(engine.notice, Some(Notice::SleepPaused));
    }

    #[test]
    fn midnight_splits_daily_totals_and_carries_the_reserve() {
        let before = Local.with_ymd_and_hms(2026, 10, 13, 23, 59, 59).unwrap();
        let mut engine = Engine::new(SavedData::default());
        engine.start(Mode::Study, before).unwrap();
        engine.advance(2000, before + Duration::seconds(2));
        assert_eq!(engine.data.days["2026-10-13"].study_ms, 1000);
        assert_eq!(engine.data.days["2026-10-14"].study_ms, 1000);
        assert_eq!(
            engine
                .snapshot(before + Duration::seconds(2), None)
                .today
                .study_ms,
            1000
        );
        assert_eq!(engine.balance(), 4000);
        engine.data.validate().unwrap();
    }

    #[test]
    fn invalid_ledgers_are_not_silently_accepted() {
        let mut saved = SavedData {
            play_ms: 1,
            ..Default::default()
        };
        assert!(saved.validate().is_err());
        saved.play_ms = 0;
        saved.study_ms = 100;
        assert!(saved.validate().is_err());
        saved.study_ms = 0;
        saved.version = 2;
        assert!(saved.validate().is_err());
    }

    fn manual(mode: Mode, duration_ms: u64) -> SessionInput {
        SessionInput {
            mode,
            started_at: (now() - Duration::hours(2)).timestamp_millis(),
            duration_ms,
        }
    }

    #[test]
    fn session_crud_updates_the_reserve_and_daily_totals() {
        let mut engine = Engine::new(SavedData::default());
        engine
            .save_session(None, manual(Mode::Study, 60_000), now())
            .unwrap();
        assert_eq!(engine.balance(), 120_000);
        engine
            .save_session(Some(1), manual(Mode::Study, 30_000), now())
            .unwrap();
        assert_eq!(engine.balance(), 60_000);
        engine
            .save_session(None, manual(Mode::Study, 60_000), now())
            .unwrap();
        engine
            .save_session(Some(1), manual(Mode::Play, 30_000), now())
            .unwrap();
        assert_eq!(engine.balance(), 90_000);
        engine.delete_session(1).unwrap();
        assert_eq!(engine.balance(), 120_000);
        engine.delete_session(2).unwrap();
        assert_eq!(engine.balance(), 0);
        assert!(engine.data.sessions.is_empty());
        engine.data.validate().unwrap();
    }

    #[test]
    fn unfunded_corrections_are_transactional() {
        let mut engine = Engine::new(SavedData::default());
        engine
            .save_session(None, manual(Mode::Study, 60_000), now())
            .unwrap();
        engine
            .save_session(None, manual(Mode::Play, 30_000), now())
            .unwrap();
        let before = serde_json::to_string(&engine.data).unwrap();
        assert!(engine
            .delete_session(1)
            .unwrap_err()
            .contains("more playtime recorded than earned"));
        assert!(engine
            .save_session(Some(1), manual(Mode::Study, 1000), now())
            .is_err());
        assert_eq!(serde_json::to_string(&engine.data).unwrap(), before);
    }

    #[test]
    fn corrections_do_not_redirect_or_modify_a_live_session() {
        let mut engine = Engine::new(SavedData::default());
        engine.start(Mode::Study, now()).unwrap();
        engine.advance(1000, now() + Duration::seconds(1));
        engine
            .save_session(None, manual(Mode::Study, 60_000), now())
            .unwrap();
        engine.advance(1000, now() + Duration::seconds(2));
        assert_eq!(engine.data.sessions[0].duration_ms, 2000);
        assert_eq!(engine.data.sessions[1].duration_ms, 60_000);
        assert_eq!(engine.active_session_id, Some(1));
        assert!(engine.delete_session(1).unwrap_err().contains("Pause"));
        assert!(engine
            .save_session(Some(1), manual(Mode::Study, 30_000), now())
            .unwrap_err()
            .contains("Pause"));
        engine
            .save_session(Some(2), manual(Mode::Study, 30_000), now())
            .unwrap();
        assert_eq!(engine.mode, Some(Mode::Study));
        assert_eq!(engine.balance(), 64_000);
        engine.data.validate().unwrap();
    }

    #[test]
    fn correction_that_empties_a_live_play_reserve_pauses_it() {
        let mut engine = Engine::new(SavedData::default());
        engine
            .save_session(None, manual(Mode::Study, 60_000), now())
            .unwrap();
        engine.start(Mode::Play, now()).unwrap();
        engine.advance(10_000, now() + Duration::seconds(10));
        assert!(engine
            .save_session(
                Some(1),
                manual(Mode::Study, 5000),
                now() + Duration::seconds(10)
            )
            .unwrap());
        assert_eq!(engine.balance(), 0);
        assert_eq!(engine.mode, None);
        assert_eq!(engine.active_session_id, None);
        assert_eq!(engine.notice, Some(Notice::BudgetEmpty));
        engine.data.validate().unwrap();
    }

    #[test]
    fn legacy_sessions_can_be_deleted_without_resetting_archived_time() {
        let mut engine = Engine::new(SavedData::default());
        engine
            .save_session(None, manual(Mode::Study, 60_000), now())
            .unwrap();
        let mut json = serde_json::to_value(&engine.data).unwrap();
        json["sessions"][0]
            .as_object_mut()
            .unwrap()
            .remove("dayTotals");
        json["studyMs"] = 65_000.into();
        json["days"]["2026-10-13"]["studyMs"] = 65_000.into();
        let data: SavedData = serde_json::from_value(json).unwrap();
        data.validate().unwrap();
        let mut restored = Engine::new(data);
        restored.delete_session(1).unwrap();
        assert_eq!(restored.data.study_ms, 5000);
        assert_eq!(restored.balance(), 10_000);
        restored.data.validate().unwrap();
    }

    #[test]
    fn manual_midnight_entries_can_be_moved_and_deleted_exactly() {
        let mut engine = Engine::new(SavedData::default());
        let start = Local.with_ymd_and_hms(2026, 10, 12, 23, 59, 59).unwrap();
        engine
            .save_session(
                None,
                SessionInput {
                    mode: Mode::Study,
                    started_at: start.timestamp_millis(),
                    duration_ms: 2000,
                },
                now(),
            )
            .unwrap();
        assert_eq!(engine.data.days["2026-10-12"].study_ms, 1000);
        assert_eq!(engine.data.days["2026-10-13"].study_ms, 1000);
        engine
            .save_session(
                Some(1),
                SessionInput {
                    mode: Mode::Study,
                    started_at: (start - Duration::minutes(1)).timestamp_millis(),
                    duration_ms: 2000,
                },
                now(),
            )
            .unwrap();
        assert_eq!(engine.data.days["2026-10-13"].study_ms, 0);
        engine.delete_session(1).unwrap();
        assert_eq!(engine.data.days["2026-10-12"].study_ms, 0);
        engine.data.validate().unwrap();
    }

    #[test]
    fn invalid_or_future_manual_entries_are_rejected() {
        let mut engine = Engine::new(SavedData::default());
        assert!(engine
            .save_session(None, manual(Mode::Study, 0), now())
            .is_err());
        assert!(engine
            .save_session(
                None,
                SessionInput {
                    mode: Mode::Study,
                    started_at: now().timestamp_millis(),
                    duration_ms: 1000
                },
                now()
            )
            .is_err());
        assert!(engine.delete_session(999).is_err());
        assert!(engine.data.sessions.is_empty());
    }
}
