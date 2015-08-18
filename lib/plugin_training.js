xemo.plugins.Training = function (tk, frame) {
	this.tk = tk;
	this.frame = frame;
	return this;
};

xemo.plugins.Training.prototype.init = function () {
    var selframe = document.createElement('div');

    $(selframe).append(' \
        <div class="xemoPluginTrainingDescription"> \
        Here you can take courses. The courses below are avaliable and are
        sorted according to the level of training.
        </div> \
        <hr/> \
    ');

    $(selframe).

    var pframe = this.frame;
    var tk = this.tk;
    for (var k in xemo.wizards) {
        var wizard = xemo.wizards[k];
        if (wizard.cat != 'training') {
        	continue;
        }
        var link = document.createElement('div');
        link.textContent = wizard.description;
        link.className = 'xemoPluginTrainingWizardLink';
        link.wizard = wizard;
        link.onclick = function () {
            this.wizard.open( { tk: tk, authkey: this.tk.getAuthHash(), pid: this.tk.getCurrentPersonnelID(), pframe: this.frame} );
        }
        $(selframe).append(link, '<br/>');
    }

    $(this.frame).empty();
    $(this.frame).append(selframe);

};

xemo.core.dialogs.TrainingCourseSelection = function (state) {
	var frame = this.NewDialog(state);
	$(frame).append('Fetching courses from database...');
	xemo.core.trainingFetchCourses(state.authkey, function (courses) {
		xemo.core.trainingFetchPersonnelData(state.authkey, state.pid, function (pcdata) {

		});
	});
}

xemo.core.trainingFetchCourses = function (key, cb) {
	xemo.core.sopv2({
		key:       key,
		op:        'training.fetch.courses',
	}, function (result) {
		cb(result);
	});
};

xemo.core.trainingFetchPersonnelData = function (key, pid, cb) {
	xemo.core.sopv2({
		key:       key,
		pid:       pid,
		op:        'training.fetch.personnel.data'
	}, function (result) {
		cb(result);
	});
}

xemo.wizards.TakeTest = {
		cat:   				'training',
		description:        'I want to take a course.', 
		open: function (state) {
			xemo.core.dialogs.TrainingCourseSelection(state, function (course_id) {

			});
		}
};

xemo.wizard.CreateTest = {
		cat:                 'training',
		description:         'I want to create a new test.',
		open: function (state) {

		} 
};

/*

// Fetch the latest scores for each unique combination of course, section, and slide
// for a specific personnel.

SELECT q1.* FROM training_personnel AS q1 
	INNER JOIN 
	(
		SELECT personnel_id, max(datetaken) AS datetaken FROM training_personnel 
		WHERE personnel_id = 0 
		GROUP BY course_id, section_id, slide_id
	) AS q2 
	ON 
		q1.datetaken = q2.datetaken AND 
		q1.personnel_id = q2.personnel_id;

// Fetch courses avaliable.
SELECT id, title, credithours, weight, level FROM training_courses WHERE deleted = 0;

CREATE TABLE training_personnel (
	personnel_id BIGINT NOT NULL,
	course_id BIGINT NOT NULL,
	section_id BIGINT NOT NULL,
	slide_id BIGINT NOT NULL,
	datetaken DATETIME NOT NULL,
	score FLOAT NOT NULL,
	secondsviewed INT NOT NULL
);

// Fetch all data needed for a course.
	
SELECT q1.title FROM training_sections AS q1 
	INNER JOIN 
	(
		SELECT section_id, stack FROM training_course_sections
		WHERE course_id = ?
	) AS q2 
	ON 
		q1.id = q2.section_id
	ORDER BY q2.stack


SELECT slide_title, weight, resource_left, resource_right FROM training_slides AS t_slides
	INNER JOIN (
	
SELECT title AS slide_title, resource_left, resource_right FROM training_slides AS t_slides
INNER JOIN (
	SELECT slide_id, weight AS section_weight, stack as slide_stack FROM training_section_slides AS t_section_to_slide
	INNER JOIN (
		SELECT title AS section_title FROM training_sections AS t_sections
		INNER JOIN (
			SELECT section_id, weight AS section_weight, stack AS section_stack FROM training_course_sections AS t_course_to_section
			INNER JOIN (
				SELECT title AS course_title FROM training_courses AS t_courses
			) ON t_courses.id = t_course_to_section.course_id;
		) ON t_course_to_section.secton_id = t_sections.id
	) ON t_section_to_slide.section_id = t_sections.id
) ON t_slides.id = t_section_to_slide.slide_id;


// KEEP
	SELECT title, weight, resource_left, resource_right FROM training_slides AS q1
		INNER JOIN (
			SELECT slide_id, stack FROM training_section_slides
			WHERE section_id = ?
		) AS q2
		ON q2.slide_id = q1.id

CREATE TABLE training_courses (
	id BIGINT PRIMARY KEY AUTO_INCREMENT, 
	title VARCHAR(120) NOT NULL, 
	credithours SMALLINT NOT NULL, 
	weight FLOAT NOT NULL, 
	level SMALLINT NOT NULL,
	certificate BIGINT NOT NULL,
);

CREATE TABLE training_course_sections (
	course_id BIGINT NOT NULL,
	section_id BIGINT NOT NULL,
	stack SMALLINT,
	weight FLOAT NOT NULL
);

CREATE TABLE training_sections (
	id BIGINT PRIMARY KEY AUTO_INCREMENT,
	title VARCHAR(80) NOT NULL,
);

CREATE TABLE training_section_slides (
	section_id BIGINT NOT NULL,
	slide_id BIGINT NOT NULL,
	stack SMALLINT,
	weight FLOAT NOT NULL
);

CREATE TABLE training_restypes (
	id SMALLINT PRIMARY KEY,
	mime VARCHAR(54) NOT NULL
);

CREATE TABLE data_resources (
	id BIGINT PRIMARY KEY AUTO_INCREMENT,
	type SMALLINT NOT NULL,
	hash VARCHAR(256) NOT NULL,
	data LONGBLOB NOT NULL
);

CREATE TABLE training_slides (
	id BIGINT PRIMARY KEY AUTO_INCREMENT,
	title VARCHAR(80) NOT NULL,
	resource_left BIGINT NOT NULL,
	resource_right BIGINT NOT NULL,
);

	<display courses>

	<button for administration functions>

	Create Course
	Edit Course
*/

xemo.plugins.Training.prototype.onshow = function () {
};

xemo.plugins.Training.prototype.onhide = function () {
};

