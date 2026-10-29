/** Issue #154: valid expressions, notes and unrestricted names must not hide syntax errors. */
export const hiddenSyntaxErrorCases = [
    {
        name: 'hyphenated quoted name',
        text: `package P {
    part def C {
        attribute 'x-y' : Real;
        langauge "ocl";
    }
}`,
        line: 3,
    },
    {
        name: 'keyword in a note',
        text: `// Each part of the vehicle, wheels first
package Vehicle {
    part def 'Front-Wheel';
    part def Engine {
        langauge "ocl";
    }
}`,
        line: 4,
    },
    {
        name: 'expression beside a missing semicolon',
        text: `part def Vehicle {
    attribute mass : Real;
    attribute weight : Real = mass * 9.81;
    attribute speed : Real
    attribute range : Real;
}`,
        line: 4,
    },
];
