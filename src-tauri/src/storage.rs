use crate::engine::SavedData;
use std::{
    fs::{self, File},
    io::{BufReader, BufWriter, Write},
    path::PathBuf,
};

pub struct Repository {
    path: PathBuf,
}

impl Repository {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Result<SavedData, String> {
        let file = match File::open(&self.path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(SavedData::default())
            }
            Err(error) => return Err(format!("Cannot open {}: {error}", self.path.display())),
        };
        let data: SavedData = serde_json::from_reader(BufReader::new(file)).map_err(|error| {
            format!(
                "Cannot read {}. Your file has not been changed: {error}",
                self.path.display()
            )
        })?;
        data.validate()?;
        Ok(data)
    }

    pub fn save(&self, data: &SavedData) -> Result<(), String> {
        let parent = self.path.parent().ok_or("Invalid data directory")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let temporary = self.path.with_extension("json.tmp");
        let file = File::create(&temporary).map_err(|e| e.to_string())?;
        let mut writer = BufWriter::new(file);
        serde_json::to_writer_pretty(&mut writer, data).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        writer.get_ref().sync_all().map_err(|e| e.to_string())?;
        // Same-directory rename is atomic on macOS. A crash leaves either the old or new ledger.
        fs::rename(&temporary, &self.path).map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{Engine, Mode};
    use chrono::{Duration, Local};

    #[test]
    fn saved_time_survives_a_round_trip_and_reopens_paused() {
        let directory = tempfile::tempdir().unwrap();
        let repository = Repository::new(directory.path().join("state.json"));
        let mut engine = Engine::new(repository.load().unwrap());
        let now = Local::now();
        engine.start(Mode::Study, now).unwrap();
        engine.advance(60_000, now + Duration::minutes(1));
        repository.save(&engine.data).unwrap();
        let loaded = Engine::new(repository.load().unwrap());
        assert_eq!(loaded.balance(), 120_000);
        assert_eq!(loaded.mode, None);
        assert_eq!(loaded.data.sessions[0].duration_ms, 60_000);
    }

    #[test]
    fn damaged_data_is_left_untouched() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.json");
        fs::write(&path, "not valid JSON").unwrap();
        let repository = Repository::new(path.clone());
        assert!(repository.load().is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "not valid JSON");
    }
}
