ALTER TABLE `user` ADD `balance` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `user` SET `balance` = (
  SELECT coalesce(sum(`amount`), 0) FROM `credit_ledger` WHERE `credit_ledger`.`user_id` = `user`.`id`
);
--> statement-breakpoint
CREATE INDEX `lesson_source_lesson_position` ON `lesson_source` (`lesson_id`, `position`);
--> statement-breakpoint
CREATE INDEX `lesson_claim_lesson` ON `lesson_claim` (`lesson_id`);
--> statement-breakpoint
CREATE INDEX `quiz_question_quiz_position` ON `quiz_question` (`quiz_id`, `position`);
--> statement-breakpoint
CREATE INDEX `quiz_attempt_quiz_created` ON `quiz_attempt` (`quiz_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `credit_order_user_created` ON `credit_order` (`user_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `credit_order_status_paid` ON `credit_order` (`status`, `paid_at`);
--> statement-breakpoint
CREATE INDEX `generation_job_user_created` ON `generation_job` (`user_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `admin_audit_target_created` ON `admin_audit` (`target_id`, `created_at`);
