ALTER TABLE `quiz` ADD `lesson_id` text;
--> statement-breakpoint
CREATE INDEX `quiz_lesson` ON `quiz` (`lesson_id`);
--> statement-breakpoint
ALTER TABLE `lesson` ADD `quiz_status` text DEFAULT 'unchecked' NOT NULL;
