const gulp = require('gulp');
const gulpCombine = require('gulp-combine');
const uglify = require('gulp-uglifyes');

gulp.task('build', function(){
    gulp.src(['src/**/*.js', '!src/mocks/**/*.js'])
        .pipe(gulpCombine({
            mainModule: "cli",
            outputFile: "bundle.js"
        }))
        .pipe(uglify({
            ecma: 6,
            toplevel: true,
            warnings: true
        }))
        .pipe(gulp.dest("dist"));
});

gulp.task('copy', function () {
    gulp.src('src/mocks/**/*.js')
        .pipe(gulp.dest('dist/mocks'));
});

gulp.task('default', ['copy', 'build']);