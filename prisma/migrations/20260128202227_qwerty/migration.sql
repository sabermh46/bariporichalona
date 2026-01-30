-- AlterTable
ALTER TABLE `house_expense` MODIFY `category` ENUM('maintenance', 'utility', 'repair', 'tax', 'salary', 'loan', 'other') NOT NULL;
