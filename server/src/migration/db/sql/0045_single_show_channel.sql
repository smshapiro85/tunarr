ALTER TABLE `channel` ADD `single_show_channel` integer DEFAULT false;--> statement-breakpoint
UPDATE `channel` SET `single_show_channel` = true WHERE `uuid` IN (
	SELECT `cp`.`channel_uuid`
	FROM `channel_programs` `cp`
	INNER JOIN `program` `p` ON `p`.`uuid` = `cp`.`program_uuid`
	GROUP BY `cp`.`channel_uuid`
	HAVING SUM(CASE WHEN `p`.`type` <> 'episode' THEN 1 ELSE 0 END) = 0
		AND SUM(CASE WHEN `p`.`tv_show_uuid` IS NULL AND COALESCE(`p`.`show_title`, '') = '' THEN 1 ELSE 0 END) = 0
		AND COUNT(DISTINCT COALESCE(`p`.`tv_show_uuid`, `p`.`show_title`)) = 1
);
